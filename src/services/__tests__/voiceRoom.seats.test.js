import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import { sequelize } from "../../config/database.js";
import { CallHistory } from "../../models/index.js";
import {
  closeVoiceRoomHandler,
  createVoiceRoomHandler,
  joinVoiceRoomSeatHandler,
  leaveVoiceRoomSeatHandler,
  leaveVoiceRoomHandler,
  startVoiceRoomHandler,
} from "../../controllers/voiceRoom.controller.js";
import {
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSeat,
  VoiceRoomSession,
} from "../../models/index.js";
import {
  ensureVoiceRoomSchema,
  resetVoiceRoomSchemaCacheForTests,
} from "../voiceRoomSchema.service.js";

const TEST_HOST_ID = 883001;
const TEST_USER_A = 883002;
const TEST_USER_B = 883003;
const TEST_USER_C = 883004;
const TEST_IDS = [TEST_HOST_ID, TEST_USER_A, TEST_USER_B, TEST_USER_C];

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
  user: { id: userId },
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

const cleanupVoiceRoomSeatTestData = async () => {
  await sequelize.query(
    `DELETE FROM voice_room_billing_ticks
     WHERE memberSessionId IN (
       SELECT id FROM voice_room_member_sessions
       WHERE userId IN (:userIds)
     )`,
    { replacements: { userIds: TEST_IDS } }
  ).catch(() => undefined);

  await CallHistory.destroy({
    where: {
      [Op.or]: [
        { callerId: { [Op.in]: TEST_IDS } },
        { receiverId: { [Op.in]: TEST_IDS } },
      ],
    },
  });

  const hostedRooms = await VoiceRoom.findAll({
    where: { hostUserId: { [Op.in]: TEST_IDS } },
    attributes: ["id"],
  });
  const hostedRoomIds = hostedRooms.map((room) => room.id);

  await VoiceRoomMemberSession.destroy({
    where: {
      [Op.or]: [
        { userId: { [Op.in]: TEST_IDS } },
        hostedRoomIds.length
          ? { roomId: { [Op.in]: hostedRoomIds } }
          : { id: -1 },
      ],
    },
  });

  if (hostedRoomIds.length) {
    await VoiceRoomSession.destroy({ where: { roomId: hostedRoomIds } });
    await VoiceRoomSeat.destroy({ where: { roomId: hostedRoomIds } });
    await VoiceRoom.destroy({ where: { id: hostedRoomIds } });
  }

  await sequelize.query("DELETE FROM users WHERE id IN (:userIds)", {
    replacements: { userIds: TEST_IDS },
  });
};

const seedUsers = async () => {
  for (const [index, userId] of TEST_IDS.entries()) {
    await sequelize.query(
      `INSERT INTO users (id, phone, username, name, gender, profileCompleted, createdAt, updatedAt)
       VALUES (:userId, :phone, :username, :name, :gender, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE username = VALUES(username), updatedAt = NOW()`,
      {
        replacements: {
          userId,
          phone: `9100${userId}${index}`,
          username: `vr_user_${userId}`,
          name: `VR User ${userId}`,
          gender: userId === TEST_HOST_ID ? "male" : "female",
        },
      }
    );
  }
};

const createStartedRoom = async (hostId = TEST_HOST_ID, title = "Seat Test Room") => {
  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(hostId, {}, { title, maxSeats: 4 }),
    createRes
  );
  assert.equal(createRes.statusCode, 201, createRes.body?.message);
  const roomId = createRes.body.room.id;

  const startRes = createMockRes();
  await startVoiceRoomHandler(authReq(hostId, { roomId }), startRes);
  assert.equal(startRes.statusCode, 200, startRes.body?.message);

  return {
    roomId,
    sessionId: startRes.body.room.session.id,
  };
};

test.before(async () => {
  resetVoiceRoomSchemaCacheForTests();
  await ensureVoiceRoomSchema();
  await cleanupVoiceRoomSeatTestData();
  await seedUsers();
  await enableVoiceRooms();
});

test.beforeEach(async () => {
  await cleanupVoiceRoomSeatTestData();
  await seedUsers();
  await enableVoiceRooms();
});

test.after(async () => {
  await disableVoiceRooms();
  await cleanupVoiceRoomSeatTestData();
  await sequelize.close();
});

test("join available seat succeeds and leave releases the seat", async () => {
  const { roomId } = await createStartedRoom();

  const joinRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    joinRes
  );

  assert.equal(joinRes.statusCode, 200);
  assert.equal(joinRes.body.room.seats[1].occupied, true);
  assert.equal(joinRes.body.room.seats[1].memberSession.userId, TEST_USER_A);

  const leaveRes = createMockRes();
  await leaveVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    leaveRes
  );

  assert.equal(leaveRes.statusCode, 200);
  assert.equal(leaveRes.body.room.seats[1].occupied, false);

  const historical = await VoiceRoomMemberSession.findOne({
    where: { roomId, userId: TEST_USER_A },
    order: [["id", "DESC"]],
  });

  assert.equal(historical.status, "left");
  assert.ok(historical.leftAt);
  assert.match(String(historical.activeMembershipGuard), /^left:\d+$/);
});

test("leave current seat succeeds without seat index", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const leaveRes = createMockRes();
  await leaveVoiceRoomHandler(authReq(TEST_USER_A, { roomId }), leaveRes);

  assert.equal(leaveRes.statusCode, 200);
  assert.equal(leaveRes.body.room.seats[1].occupied, false);
});

test("user can leave after rejoining a different seat in the same room", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  await leaveVoiceRoomHandler(authReq(TEST_USER_A, { roomId }), createMockRes());

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "4" }),
    createMockRes()
  );

  const leaveRes = createMockRes();
  await leaveVoiceRoomHandler(authReq(TEST_USER_A, { roomId }), leaveRes);

  assert.equal(leaveRes.statusCode, 200);
  assert.equal(leaveRes.body.room.seats[3].occupied, false);

  const leftRows = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      userId: TEST_USER_A,
      status: "left",
    },
  });

  assert.equal(leftRows, 2);
});

test("join occupied seat fails cleanly", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "3" }),
    createMockRes()
  );

  const conflictRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_B, { roomId, seatIndex: "3" }),
    conflictRes
  );

  assert.equal(conflictRes.statusCode, 409);
  assert.match(conflictRes.body.message, /occupied/i);
});

test("same user cannot take two seats in one room", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const secondSeatRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "4" }),
    secondSeatRes
  );

  assert.equal(secondSeatRes.statusCode, 409);
  assert.match(secondSeatRes.body.message, /already/i);
});

test("duplicate join on the same seat is idempotent", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const duplicateRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    duplicateRes
  );

  assert.equal(duplicateRes.statusCode, 200);

  const activeMemberships = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      userId: TEST_USER_A,
      status: { [Op.in]: ["joining", "connected", "billing"] },
    },
  });

  assert.equal(activeMemberships, 1);
});

test("concurrent join on the same seat allows exactly one occupant", async () => {
  const { roomId } = await createStartedRoom();

  const results = await Promise.all([
    joinVoiceRoomSeatHandler(
      authReq(TEST_USER_A, { roomId, seatIndex: "3" }),
      createMockRes()
    ),
    joinVoiceRoomSeatHandler(
      authReq(TEST_USER_B, { roomId, seatIndex: "3" }),
      createMockRes()
    ),
  ]);

  const statuses = results.map((res) => res.statusCode).sort();
  assert.deepEqual(statuses, [200, 409]);

  const seat = await VoiceRoomSeat.findOne({
    where: { roomId, seatIndex: 3 },
  });

  assert.ok(seat.memberSessionId);

  const occupantCount = await VoiceRoomMemberSession.count({
    where: {
      roomId,
      seatIndex: 3,
      status: { [Op.in]: ["joining", "connected", "billing"] },
    },
  });

  assert.equal(occupantCount, 1);
});

test("user cannot join a second voice room while already seated", async () => {
  const roomOne = await createStartedRoom(TEST_HOST_ID, "Room One");
  const roomTwo = await createStartedRoom(TEST_USER_C, "Room Two");

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId: roomOne.roomId, seatIndex: "2" }),
    createMockRes()
  );

  const secondRoomRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId: roomTwo.roomId, seatIndex: "2" }),
    secondRoomRes
  );

  assert.equal(secondRoomRes.statusCode, 409);
  assert.match(secondRoomRes.body.message, /already/i);
});

test("user in active 1-to-1 call cannot join voice room and call remains untouched", async () => {
  const { roomId } = await createStartedRoom();

  const call = await CallHistory.create({
    callerId: TEST_USER_A,
    receiverId: TEST_HOST_ID,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "accepted",
  });

  const joinRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    joinRes
  );

  assert.equal(joinRes.statusCode, 409);
  assert.match(joinRes.body.message, /current call/i);

  await call.reload();
  assert.equal(call.status, "accepted");

  await call.destroy();
});

test("leave on another user's seat is rejected", async () => {
  const { roomId } = await createStartedRoom();

  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "2" }),
    createMockRes()
  );

  const leaveRes = createMockRes();
  await leaveVoiceRoomSeatHandler(
    authReq(TEST_USER_B, { roomId, seatIndex: "2" }),
    leaveRes
  );

  assert.equal(leaveRes.statusCode, 403);
});

test("join is rejected when feature flag is disabled", async () => {
  const { roomId } = await createStartedRoom();
  await disableVoiceRooms();

  const joinRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_B, { roomId, seatIndex: "2" }),
    joinRes
  );

  assert.equal(joinRes.statusCode, 403);

  await enableVoiceRooms();
});

test("join fails when room is closed during allocation", async () => {
  const { roomId } = await createStartedRoom();

  await closeVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), createMockRes());

  const joinRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_B, { roomId, seatIndex: "2" }),
    joinRes
  );

  assert.equal(joinRes.statusCode, 400);
  assert.match(joinRes.body.message, /not live/i);
});

test("invalid seat numbers are rejected", async () => {
  const { roomId } = await createStartedRoom();

  const joinRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_USER_A, { roomId, seatIndex: "9" }),
    joinRes
  );

  assert.equal(joinRes.statusCode, 404);
});
