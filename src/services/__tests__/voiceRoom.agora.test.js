import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import { sequelize } from "../../config/database.js";
import { getVoiceRoomChannelName } from "../../constants/voiceRoom.js";
import {
  closeVoiceRoomHandler,
  createVoiceRoomHandler,
  getVoiceRoomAgoraTokenHandler,
  joinVoiceRoomSeatHandler,
  leaveVoiceRoomSeatHandler,
  startVoiceRoomHandler,
} from "../../controllers/voiceRoom.controller.js";
import {
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSeat,
  VoiceRoomSession,
} from "../../models/index.js";
import {
  getVoiceRoomAgoraChannelName,
  getVoiceRoomAgoraCredentials,
  resolveVoiceRoomAgoraUid,
} from "../voiceRoomAgora.service.js";
import {
  ensureVoiceRoomSchema,
  resetVoiceRoomSchemaCacheForTests,
} from "../voiceRoomSchema.service.js";

const TEST_HOST_ID = 885001;
const TEST_USER_A = 885002;
const TEST_USER_B = 885003;
const TEST_IDS = [TEST_HOST_ID, TEST_USER_A, TEST_USER_B];

const createMockRes = () => {
  let statusCode = 200;
  let body = null;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
};

const authReq = (userId, params = {}, body = {}) => ({
  user: userId ? { id: userId } : undefined,
  params,
  body,
});

const enableVoiceRooms = async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 1 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
};

const disableVoiceRooms = async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 0 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
};

const cleanup = async () => {
  const hostedRooms = await VoiceRoom.findAll({
    where: { hostUserId: { [Op.in]: TEST_IDS } },
    attributes: ["id"],
  });
  const roomIds = hostedRooms.map((room) => room.id);

  if (roomIds.length) {
    await VoiceRoomMemberSession.destroy({ where: { roomId: roomIds } });
    await VoiceRoomSession.destroy({ where: { roomId: roomIds } });
    await VoiceRoomSeat.destroy({ where: { roomId: roomIds } });
    await VoiceRoom.destroy({ where: { id: roomIds } });
  }

  await sequelize.query("DELETE FROM users WHERE id IN (:userIds)", {
    replacements: { userIds: TEST_IDS },
  });
};

const seedUsers = async () => {
  for (const userId of TEST_IDS) {
    await sequelize.query(
      `INSERT INTO users (id, phone, username, name, gender, profileCompleted, createdAt, updatedAt)
       VALUES (:userId, :phone, :username, :name, :gender, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE username = VALUES(username), updatedAt = NOW()`,
      {
        replacements: {
          userId,
          phone: `9300${userId}`,
          username: `vr_agora_${userId}`,
          name: `VR Agora ${userId}`,
          gender: userId === TEST_HOST_ID ? "male" : "female",
        },
      }
    );
  }
};

const createStartedRoom = async () => {
  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "Agora Room", maxSeats: 4 }),
    createRes
  );

  const roomId = createRes.body.room.id;
  const startRes = createMockRes();
  await startVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), startRes);

  return {
    roomId,
    sessionId: startRes.body.room.session.id,
    channelName: startRes.body.room.session.agoraChannelName,
  };
};

test.before(async () => {
  resetVoiceRoomSchemaCacheForTests();
  await ensureVoiceRoomSchema();
  await cleanup();
  await seedUsers();
});

test.beforeEach(async () => {
  await cleanup();
  await seedUsers();
  await enableVoiceRooms();
});

test.after(async () => {
  await disableVoiceRooms();
  await cleanup();
  await sequelize.close();
});

test("voice room channel names stay isolated from 1-to-1 call channels", () => {
  assert.equal(getVoiceRoomAgoraChannelName(99), "voice_room_99");
  assert.notEqual(getVoiceRoomAgoraChannelName(99), "call_99");
});

test("resolveVoiceRoomAgoraUid uses authenticated user id", () => {
  assert.equal(resolveVoiceRoomAgoraUid(TEST_USER_A), TEST_USER_A);
});

test("authenticated member receives Agora token for active membership", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const res = createMockRes();
  await getVoiceRoomAgoraTokenHandler(authReq(TEST_USER_A, { roomId }), res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.agora.token);
  assert.equal(res.body.agora.uid, TEST_USER_A);
  assert.match(res.body.agora.channelName, /^voice_room_\d+$/);
  assert.ok(res.body.agora.appId);
  assert.equal(res.body.agora.roomId, roomId);
  assert.equal(res.body.agora.seatIndex, 2);
});

test("host receives Agora token from seat 1 membership", async () => {
  const { roomId, channelName } = await createStartedRoom();

  const res = createMockRes();
  await getVoiceRoomAgoraTokenHandler(authReq(TEST_HOST_ID, { roomId }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agora.uid, TEST_HOST_ID);
  assert.equal(res.body.agora.channelName, channelName);
  assert.equal(res.body.agora.seatIndex, 1);
});

test("non-member is rejected", async () => {
  const { roomId } = await createStartedRoom();

  const res = createMockRes();
  await getVoiceRoomAgoraTokenHandler(authReq(TEST_USER_A, { roomId }), res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /membership required/i);
});

test("unauthenticated request is rejected", async () => {
  const { roomId } = await createStartedRoom();

  const res = createMockRes();
  await getVoiceRoomAgoraTokenHandler(authReq(null, { roomId }), res);

  assert.equal(res.statusCode, 401);
});

test("member of another room cannot request token for a different room", async () => {
  const roomA = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId: roomA.roomId, seatIndex: "2" }),
    createMockRes()
  );

  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_USER_B, {}, { title: "Second Agora Room", maxSeats: 4 }),
    createRes
  );
  const roomBId = createRes.body.room.id;
  const startRes = createMockRes();
  await startVoiceRoomHandler(authReq(TEST_USER_B, { roomId: roomBId }), startRes);

  const res = createMockRes();
  await getVoiceRoomAgoraTokenHandler(
    authReq(TEST_USER_A, { roomId: roomBId }),
    res
  );

  assert.equal(res.statusCode, 403);
});

test("closed room rejects new Agora token requests", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  await closeVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), createMockRes());

  const res = createMockRes();
  await getVoiceRoomAgoraTokenHandler(authReq(TEST_USER_A, { roomId }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /not live/i);
});

test("feature disabled rejects Agora token requests", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  await disableVoiceRooms();

  const res = createMockRes();
  await getVoiceRoomAgoraTokenHandler(authReq(TEST_USER_A, { roomId }), res);

  assert.equal(res.statusCode, 403);
});

test("multiple members receive the same channel with distinct UIDs", async () => {
  const { roomId, channelName } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_B, { roomId, seatIndex: "3" }),
    createMockRes()
  );

  const hostCredentials = await getVoiceRoomAgoraCredentials(TEST_HOST_ID, roomId);
  const userACredentials = await getVoiceRoomAgoraCredentials(TEST_USER_A, roomId);
  const userBCredentials = await getVoiceRoomAgoraCredentials(TEST_USER_B, roomId);

  assert.equal(hostCredentials.channelName, channelName);
  assert.equal(userACredentials.channelName, channelName);
  assert.equal(userBCredentials.channelName, channelName);
  assert.equal(hostCredentials.channelName, getVoiceRoomChannelName(hostCredentials.sessionId));

  const uids = new Set([
    hostCredentials.uid,
    userACredentials.uid,
    userBCredentials.uid,
  ]);

  assert.equal(uids.size, 3);
  assert.equal(hostCredentials.uid, TEST_HOST_ID);
  assert.equal(userACredentials.uid, TEST_USER_A);
  assert.equal(userBCredentials.uid, TEST_USER_B);
});

test("reconnect token request is idempotent and preserves membership", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const first = await getVoiceRoomAgoraCredentials(TEST_USER_A, roomId);
  const second = await getVoiceRoomAgoraCredentials(TEST_USER_A, roomId);

  assert.equal(first.uid, second.uid);
  assert.equal(first.channelName, second.channelName);
  assert.equal(first.memberSessionId, second.memberSessionId);
  assert.ok(first.token);
  assert.ok(second.token);

  const activeCount = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      userId: TEST_USER_A,
      status: { [Op.in]: ["joining", "connected", "billing"] },
    },
  });

  assert.equal(activeCount, 1);
});

test("invalid room id is rejected", async () => {
  await assert.rejects(
    () => getVoiceRoomAgoraCredentials(TEST_USER_A, "abc"),
    /not found/i
  );
});

test("Agora leave concept does not release database seat", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  await getVoiceRoomAgoraCredentials(TEST_USER_A, roomId);

  const activeCount = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      userId: TEST_USER_A,
      status: { [Op.in]: ["joining", "connected", "billing"] },
    },
  });

  assert.equal(activeCount, 1);

  await leaveVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const afterLeaveCount = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      userId: TEST_USER_A,
      status: { [Op.in]: ["joining", "connected", "billing"] },
    },
  });

  assert.equal(afterLeaveCount, 0);
});

test("token channel name matches live session agoraChannelName in database", async () => {
  const { roomId, sessionId } = await createStartedRoom();

  const session = await VoiceRoomSession.findByPk(sessionId);
  const credentials = await getVoiceRoomAgoraCredentials(TEST_HOST_ID, roomId);

  assert.equal(credentials.channelName, session.agoraChannelName);
  assert.equal(credentials.channelName, getVoiceRoomChannelName(sessionId));
});
