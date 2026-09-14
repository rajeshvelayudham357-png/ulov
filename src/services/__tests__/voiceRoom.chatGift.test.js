import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import { sequelize } from "../../config/database.js";
import {
  createVoiceRoomHandler,
  getVoiceRoomChatHandler,
  getVoiceRoomGiftsCatalogHandler,
  joinVoiceRoomSeatHandler,
  sendVoiceRoomChatHandler,
  sendVoiceRoomGiftHandler,
  startVoiceRoomHandler,
} from "../../controllers/voiceRoom.controller.js";
import {
  VoiceRoom,
  VoiceRoomGiftRecord,
  VoiceRoomMemberSession,
  VoiceRoomMessage,
  VoiceRoomSeat,
  VoiceRoomSession,
  Wallet,
} from "../../models/index.js";
import {
  ensureVoiceRoomSchema,
  resetVoiceRoomSchemaCacheForTests,
} from "../voiceRoomSchema.service.js";

const TEST_MALE_ID = 884001;
const TEST_FEMALE_ID = 884002;
const TEST_IDS = [TEST_MALE_ID, TEST_FEMALE_ID];

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

const authReq = (userId, params = {}, body = {}, query = {}) => ({
  user: { id: userId },
  params,
  body,
  query,
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

const cleanupTestData = async () => {
  const hostedRooms = await VoiceRoom.findAll({
    where: { hostUserId: { [Op.in]: TEST_IDS } },
    attributes: ["id"],
  });
  const hostedRoomIds = hostedRooms.map((room) => room.id);

  if (hostedRoomIds.length) {
    await VoiceRoomGiftRecord.destroy({ where: { roomId: hostedRoomIds } });
    await VoiceRoomMessage.destroy({ where: { roomId: hostedRoomIds } });
    await VoiceRoomMemberSession.destroy({ where: { roomId: hostedRoomIds } });
    await VoiceRoomSession.destroy({ where: { roomId: hostedRoomIds } });
    await VoiceRoomSeat.destroy({ where: { roomId: hostedRoomIds } });
    await VoiceRoom.destroy({ where: { id: hostedRoomIds } });
  }

  await Wallet.destroy({ where: { userId: { [Op.in]: TEST_IDS } } });
  await sequelize.query("DELETE FROM users WHERE id IN (:userIds)", {
    replacements: { userIds: TEST_IDS },
  });
};

const seedUsers = async () => {
  await sequelize.query(
    `INSERT INTO users (id, phone, username, name, gender, profileCompleted, createdAt, updatedAt)
     VALUES
      (:maleId, :malePhone, 'vr_male', 'VR Male', 'male', 1, NOW(), NOW()),
      (:femaleId, :femalePhone, 'vr_female', 'VR Female', 'female', 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE username = VALUES(username), updatedAt = NOW()`,
    {
      replacements: {
        maleId: TEST_MALE_ID,
        femaleId: TEST_FEMALE_ID,
        malePhone: `9200${TEST_MALE_ID}`,
        femalePhone: `9200${TEST_FEMALE_ID}`,
      },
    }
  );
};

const createStartedRoomWithParticipants = async () => {
  const createRes = createMockRes();
  await createVoiceRoomHandler(
    authReq(TEST_MALE_ID, {}, { title: "Gift Chat Room", maxSeats: 4 }),
    createRes
  );
  assert.equal(createRes.statusCode, 201);
  const roomId = createRes.body.room.id;

  const startRes = createMockRes();
  await startVoiceRoomHandler(authReq(TEST_MALE_ID, { roomId }), startRes);
  assert.equal(startRes.statusCode, 200);

  const joinRes = createMockRes();
  await joinVoiceRoomSeatHandler(
    authReq(TEST_FEMALE_ID, { roomId, seatIndex: 2 }),
    joinRes
  );
  assert.equal(joinRes.statusCode, 200, joinRes.body?.message);

  return { roomId, sessionId: startRes.body.room.session.id };
};

test.before(async () => {
  resetVoiceRoomSchemaCacheForTests();
  await ensureVoiceRoomSchema();
  await cleanupTestData();
  await seedUsers();
  await enableVoiceRooms();
});

test.beforeEach(async () => {
  await cleanupTestData();
  await seedUsers();
});

test.after(async () => {
  await disableVoiceRooms();
  await cleanupTestData();
  await sequelize.close();
});

test("voice room chat send and list works for active members", async () => {
  const { roomId } = await createStartedRoomWithParticipants();

  const sendRes = createMockRes();
  await sendVoiceRoomChatHandler(
    authReq(TEST_MALE_ID, { roomId }, { messageText: "Hello room!" }),
    sendRes
  );

  assert.equal(sendRes.statusCode, 201);
  assert.equal(sendRes.body.message.messageText, "Hello room!");
  assert.equal(sendRes.body.message.userId, TEST_MALE_ID);

  const listRes = createMockRes();
  await getVoiceRoomChatHandler(authReq(TEST_FEMALE_ID, { roomId }), listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(getMessages(listRes).length, 1);
  assert.equal(getMessages(listRes)[0].messageText, "Hello room!");
});

test("voice room chat rejects empty messages", async () => {
  const { roomId } = await createStartedRoomWithParticipants();

  const sendRes = createMockRes();
  await sendVoiceRoomChatHandler(
    authReq(TEST_MALE_ID, { roomId }, { messageText: "   " }),
    sendRes
  );

  assert.equal(sendRes.statusCode, 400);
  assert.match(sendRes.body.message, /cannot be empty/i);
});

test("voice room gifts catalog returns call gift catalog", async () => {
  const catalogRes = createMockRes();
  await getVoiceRoomGiftsCatalogHandler({}, catalogRes);

  assert.equal(catalogRes.statusCode, 200);
  assert.ok(Array.isArray(catalogRes.body.gifts));
  assert.ok(catalogRes.body.gifts.length > 0);
  assert.ok(catalogRes.body.gifts[0].femaleEarnCoins >= 0);
});

test("voice room gift send debits male wallet and records gift", async () => {
  const { roomId } = await createStartedRoomWithParticipants();

  await Wallet.create({
    userId: TEST_MALE_ID,
    balance: 500,
  });

  const sendRes = createMockRes();
  await sendVoiceRoomGiftHandler(
    authReq(
      TEST_MALE_ID,
      { roomId },
      { receiverId: TEST_FEMALE_ID, giftId: "roses_for_you" }
    ),
    sendRes
  );

  assert.equal(sendRes.statusCode, 201, sendRes.body?.message);
  assert.equal(sendRes.body.receiver.id, TEST_FEMALE_ID);
  assert.ok(sendRes.body.wallet.balance < 500);

  const wallet = await Wallet.findOne({ where: { userId: TEST_MALE_ID } });
  assert.equal(Number(wallet.balance), Number(sendRes.body.wallet.balance));

  const records = await VoiceRoomGiftRecord.findAll({ where: { roomId } });
  assert.equal(records.length, 1);
});

test("voice room gift rejects female senders and insufficient balance", async () => {
  const { roomId } = await createStartedRoomWithParticipants();

  const femaleSendRes = createMockRes();
  await sendVoiceRoomGiftHandler(
    authReq(
      TEST_FEMALE_ID,
      { roomId },
      { receiverId: TEST_MALE_ID, giftId: "roses_for_you" }
    ),
    femaleSendRes
  );
  assert.equal(femaleSendRes.statusCode, 400);
  assert.match(femaleSendRes.body.message, /only male/i);

  await Wallet.create({
    userId: TEST_MALE_ID,
    balance: 0,
  });

  const lowBalanceRes = createMockRes();
  await sendVoiceRoomGiftHandler(
    authReq(
      TEST_MALE_ID,
      { roomId },
      { receiverId: TEST_FEMALE_ID, giftId: "roses_for_you" }
    ),
    lowBalanceRes
  );
  assert.equal(lowBalanceRes.statusCode, 400);
  assert.match(lowBalanceRes.body.message, /insufficient gold balance/i);
});

const getMessages = (res) => res.body.messages ?? [];
