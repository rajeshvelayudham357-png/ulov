import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import { sequelize } from "../../config/database.js";
import {
  VOICE_ROOM_MEMBER_ROLES,
  VOICE_ROOM_SESSION_STATUSES,
  VOICE_ROOM_STATUSES,
  getVoiceRoomChannelName,
} from "../../constants/voiceRoom.js";
import {
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSeat,
  VoiceRoomSession,
} from "../../models/index.js";
import {
  closeVoiceRoomHandler,
  createVoiceRoomHandler,
  getVoiceRoomFeatureStatusHandler,
  getVoiceRoomHandler,
  listLiveVoiceRoomsHandler,
  startVoiceRoomHandler,
} from "../../controllers/voiceRoom.controller.js";
import {
  ensureVoiceRoomSchema,
  resetVoiceRoomSchemaCacheForTests,
} from "../voiceRoomSchema.service.js";

const TEST_HOST_ID = 882001;
const TEST_OTHER_ID = 882002;

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

const cleanupVoiceRoomTestData = async () => {
  await sequelize.query(
    `DELETE FROM voice_room_billing_ticks
     WHERE memberSessionId IN (
       SELECT id FROM voice_room_member_sessions WHERE userId IN (:userIds)
     )`,
    { replacements: { userIds: [TEST_HOST_ID, TEST_OTHER_ID] } }
  );
  await VoiceRoomMemberSession.destroy({
    where: { userId: [TEST_HOST_ID, TEST_OTHER_ID] },
  });
  await VoiceRoomSeat.destroy({
    where: {
      roomId: {
        [Op.in]: sequelize.literal(
          `(SELECT id FROM voice_rooms WHERE hostUserId IN (${TEST_HOST_ID}, ${TEST_OTHER_ID}))`
        ),
      },
    },
  }).catch(() => undefined);

  const rooms = await VoiceRoom.findAll({
    where: { hostUserId: [TEST_HOST_ID, TEST_OTHER_ID] },
    attributes: ["id"],
  });
  const roomIds = rooms.map((room) => room.id);

  if (roomIds.length) {
    await VoiceRoomSession.destroy({ where: { roomId: roomIds } });
    await VoiceRoomSeat.destroy({ where: { roomId: roomIds } });
    await VoiceRoom.destroy({ where: { id: roomIds } });
  }

  await sequelize.query(
    "DELETE FROM users WHERE id IN (:userIds)",
    { replacements: { userIds: [TEST_HOST_ID, TEST_OTHER_ID] } }
  );
};

const seedVoiceRoomUsers = async () => {
  await sequelize.query(
    `INSERT INTO users (id, phone, username, name, gender, profileCompleted, createdAt, updatedAt)
     VALUES
      (:hostId, :hostPhone, 'vr_host', 'VR Host', 'male', 1, NOW(), NOW()),
      (:otherId, :otherPhone, 'vr_other', 'VR Other', 'female', 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      name = VALUES(name),
      gender = VALUES(gender),
      updatedAt = NOW()`,
    {
      replacements: {
        hostId: TEST_HOST_ID,
        otherId: TEST_OTHER_ID,
        hostPhone: `9000${TEST_HOST_ID}`,
        otherPhone: `9000${TEST_OTHER_ID}`,
      },
    }
  );
};

test.before(async () => {
  resetVoiceRoomSchemaCacheForTests();
  await ensureVoiceRoomSchema();
  await cleanupVoiceRoomTestData();
  await seedVoiceRoomUsers();
});

test.after(async () => {
  await cleanupVoiceRoomTestData();
  await sequelize.close();
});

test("feature status returns disabled by default", async () => {
  const res = createMockRes();
  await getVoiceRoomFeatureStatusHandler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.ratePerMinute, 5);
});

test("voice room CRUD routes reject access while feature flag is disabled", async () => {
  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "Test Room", maxSeats: 4 }),
    createRes
  );

  assert.equal(createRes.statusCode, 403);
  assert.match(createRes.body.message, /not available/i);

  const listRes = createMockRes();
  await listLiveVoiceRoomsHandler({}, listRes);
  assert.equal(listRes.statusCode, 403);
});

test("voice room lifecycle works when feature flag is enabled", async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 1 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();

  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "Friday Hangout", maxSeats: 4 }),
    createRes
  );

  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.room.title, "Friday Hangout");
  assert.equal(createRes.body.room.status, VOICE_ROOM_STATUSES.DRAFT);
  assert.equal(createRes.body.room.maxSeats, 4);

  const roomId = createRes.body.room.id;

  const startRes = createMockRes();
  await startVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), startRes);

  assert.equal(startRes.statusCode, 200);
  assert.equal(startRes.body.room.status, VOICE_ROOM_STATUSES.LIVE);
  assert.equal(startRes.body.room.session.agoraChannelName, getVoiceRoomChannelName(startRes.body.room.session.id));
  assert.equal(startRes.body.room.seats.length, 4);
  assert.equal(startRes.body.room.seats[0].occupied, true);
  assert.equal(startRes.body.room.seats[0].memberSession.role, VOICE_ROOM_MEMBER_ROLES.HOST);

  const listRes = createMockRes();
  await listLiveVoiceRoomsHandler({}, listRes);
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.rooms.length, 1);
  assert.equal(listRes.body.rooms[0].participantCount, 1);

  const detailRes = createMockRes();
  await getVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), detailRes);
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.body.room.isHost, true);

  const closeRes = createMockRes();
  await closeVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), closeRes);
  assert.equal(closeRes.statusCode, 200);
  assert.equal(closeRes.body.status, VOICE_ROOM_STATUSES.CLOSED);

  const session = await VoiceRoomSession.findByPk(startRes.body.room.session.id);
  assert.equal(session.status, VOICE_ROOM_SESSION_STATUSES.CLOSED);
  assert.ok(session.endedAt);

  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 0 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
});

test("non-host cannot start or close a voice room", async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 1 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();

  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "Host Only", maxSeats: 3 }),
    createRes
  );
  const roomId = createRes.body.room.id;

  const startRes = createMockRes();
  await startVoiceRoomHandler(authReq(TEST_OTHER_ID, { roomId }), startRes);
  assert.equal(startRes.statusCode, 400);
  assert.match(startRes.body.message, /only the host/i);

  await startVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), createMockRes());

  const closeRes = createMockRes();
  await closeVoiceRoomHandler(authReq(TEST_OTHER_ID, { roomId }), closeRes);
  assert.equal(closeRes.statusCode, 400);
  assert.match(closeRes.body.message, /only the host/i);

  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 0 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
});

test("starting a new room closes the host's previous live room", async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 1 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();

  const firstCreate = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "First Live Room", maxSeats: 4 }),
    firstCreate
  );
  const firstRoomId = firstCreate.body.room.id;
  await startVoiceRoomHandler(
    authReq(TEST_HOST_ID, { roomId: firstRoomId }),
    createMockRes()
  );

  const secondCreate = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "Second Live Room", maxSeats: 4 }),
    secondCreate
  );
  const startRes = createMockRes();
  await startVoiceRoomHandler(
    authReq(TEST_HOST_ID, { roomId: secondCreate.body.room.id }),
    startRes
  );

  assert.equal(startRes.statusCode, 200, startRes.body?.message);
  assert.equal(startRes.body.room.status, VOICE_ROOM_STATUSES.LIVE);
  assert.equal(startRes.body.room.title, "Second Live Room");

  const firstRoom = await VoiceRoom.findByPk(firstRoomId);
  assert.equal(firstRoom.status, VOICE_ROOM_STATUSES.CLOSED);

  const activeGuards = await VoiceRoomMemberSession.count({
    where: {
      userId: TEST_HOST_ID,
      activeMembershipGuard: `user:${TEST_HOST_ID}`,
    },
  });
  assert.equal(activeGuards, 1);

  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 0 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
});

test("retrying start after a partial seat insert succeeds", async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 1 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();

  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "Retry Start Room", maxSeats: 3 }),
    createRes
  );
  const roomId = createRes.body.room.id;

  await VoiceRoomSession.create({
    roomId,
    agoraChannelName: "pending",
    status: VOICE_ROOM_SESSION_STATUSES.LIVE,
    startedAt: new Date(),
    ratePerMinute: 5,
    hostPercentage: 50,
  });

  await VoiceRoomSeat.bulkCreate([
    { roomId, seatIndex: 1, memberSessionId: null },
    { roomId, seatIndex: 2, memberSessionId: null },
    { roomId, seatIndex: 3, memberSessionId: null },
  ]);

  const startRes = createMockRes();
  await startVoiceRoomHandler(authReq(TEST_HOST_ID, { roomId }), startRes);

  assert.equal(startRes.statusCode, 200, startRes.body?.message);
  assert.equal(startRes.body.room.status, VOICE_ROOM_STATUSES.LIVE);
  assert.equal(startRes.body.room.seats.length, 3);
  assert.equal(startRes.body.room.seats[0].occupied, true);

  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 0 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
});

test("start succeeds when a stale membership lock was not released", async () => {
  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 1 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();

  const staleCreate = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "Stale Lock Room", maxSeats: 3 }),
    staleCreate
  );
  const staleStart = createMockRes();
  await startVoiceRoomHandler(
    authReq(TEST_HOST_ID, { roomId: staleCreate.body.room.id }),
    staleStart
  );

  await VoiceRoomMemberSession.update(
    {
      status: "left",
      leftAt: new Date(),
      activeMembershipGuard: `user:${TEST_HOST_ID}`,
    },
    { where: { userId: TEST_HOST_ID, roomId: staleCreate.body.room.id } }
  );
  await VoiceRoom.update(
    { status: VOICE_ROOM_STATUSES.CLOSED },
    { where: { id: staleCreate.body.room.id } }
  );
  await VoiceRoomSession.update(
    { status: VOICE_ROOM_SESSION_STATUSES.CLOSED, endedAt: new Date() },
    { where: { roomId: staleCreate.body.room.id } }
  );

  const nextCreate = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_HOST_ID, {}, { title: "After Stale Lock", maxSeats: 3 }),
    nextCreate
  );
  const startRes = createMockRes();
  await startVoiceRoomHandler(
    authReq(TEST_HOST_ID, { roomId: nextCreate.body.room.id }),
    startRes
  );

  assert.equal(startRes.statusCode, 200, startRes.body?.message);
  assert.equal(startRes.body.room.status, VOICE_ROOM_STATUSES.LIVE);
  assert.equal(startRes.body.room.title, "After Stale Lock");

  await sequelize.query(
    "UPDATE admin_voice_room_settings SET enabled = 0 WHERE id = 1"
  );
  resetVoiceRoomSchemaCacheForTests();
});
