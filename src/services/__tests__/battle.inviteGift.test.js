import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import { sequelize } from "../../config/database.js";
import {
  acceptBattleInviteHandler,
  createBattleInviteHandler,
  joinBattleAudienceHandler,
  listBattleOpponentsHandler,
  sendBattleGiftHandler,
} from "../../controllers/battle.controller.js";
import {
  BattleAudienceSession,
  BattleFighter,
  BattleGiftRecord,
  BattleInvite,
  BattleRoom,
  CallHistory,
  Earning,
  VoiceRoomMemberSession,
  Wallet,
} from "../../models/index.js";
import {
  ensureBattleSchema,
  resetBattleSchemaCacheForTests,
} from "../battleSchema.service.js";

const TEST_FEMALE_A = 885001;
const TEST_FEMALE_B = 885002;
const TEST_MALE_ID = 885003;
const TEST_IDS = [TEST_FEMALE_A, TEST_FEMALE_B, TEST_MALE_ID];

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

const enableBattles = async () => {
  await sequelize.query(
    "UPDATE admin_battle_settings SET enabled = 1 WHERE id = 1"
  );
  resetBattleSchemaCacheForTests();
};

const disableBattles = async () => {
  await sequelize.query(
    "UPDATE admin_battle_settings SET enabled = 0 WHERE id = 1"
  );
  resetBattleSchemaCacheForTests();
};

const cleanupTestData = async () => {
  const invites = await BattleInvite.findAll({
    where: {
      [Op.or]: [
        { challengerId: { [Op.in]: TEST_IDS } },
        { opponentId: { [Op.in]: TEST_IDS } },
      ],
    },
    attributes: ["id", "battleId"],
  });

  const battleIds = invites
    .map((invite) => invite.battleId)
    .filter(Boolean);

  if (battleIds.length) {
    await BattleGiftRecord.destroy({ where: { battleId: battleIds } });
    await BattleAudienceSession.destroy({ where: { battleId: battleIds } });
    await BattleFighter.destroy({ where: { battleId: battleIds } });
    await BattleRoom.destroy({ where: { id: battleIds } });
  }

  await BattleInvite.destroy({
    where: {
      [Op.or]: [
        { challengerId: { [Op.in]: TEST_IDS } },
        { opponentId: { [Op.in]: TEST_IDS } },
      ],
    },
  });

  await Earning.destroy({ where: { userId: { [Op.in]: TEST_IDS } } });
  await Wallet.destroy({ where: { userId: { [Op.in]: TEST_IDS } } });
  await VoiceRoomMemberSession.destroy({
    where: { userId: { [Op.in]: TEST_IDS } },
  });
};

const seedUsers = async () => {
  await sequelize.query(
    `INSERT INTO users
      (id, phone, username, name, gender, profileCompleted, accountStatus, online, createdAt, updatedAt)
     VALUES
      (:femaleAId, :femaleAPhone, 'battle_a', 'Battle A', 'female', 1, 'approved', 1, NOW(), NOW()),
      (:femaleBId, :femaleBPhone, 'battle_b', 'Battle B', 'female', 1, 'approved', 1, NOW(), NOW()),
      (:maleId, :malePhone, 'battle_male', 'Battle Male', 'male', 1, 'approved', 0, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      name = VALUES(name),
      gender = VALUES(gender),
      accountStatus = VALUES(accountStatus),
      online = VALUES(online),
      updatedAt = NOW()`,
    {
      replacements: {
        femaleAId: TEST_FEMALE_A,
        femaleBId: TEST_FEMALE_B,
        maleId: TEST_MALE_ID,
        femaleAPhone: `9300${TEST_FEMALE_A}`,
        femaleBPhone: `9300${TEST_FEMALE_B}`,
        malePhone: `9300${TEST_MALE_ID}`,
      },
    }
  );

  await Wallet.create({
    userId: TEST_MALE_ID,
    balance: 5000,
  }).catch(async () => {
    await Wallet.update(
      { balance: 5000 },
      { where: { userId: TEST_MALE_ID } }
    );
  });
};

const createAcceptedLiveBattle = async () => {
  const inviteRes = createMockRes();
  await createBattleInviteHandler(
    authReq(TEST_FEMALE_A, {}, { opponentId: TEST_FEMALE_B, durationSeconds: 120 }),
    inviteRes
  );

  assert.equal(inviteRes.statusCode, 201, inviteRes.body?.message);
  const inviteId = inviteRes.body.id;

  const acceptRes = createMockRes();
  await acceptBattleInviteHandler(
    authReq(TEST_FEMALE_B, { inviteId }),
    acceptRes
  );

  assert.equal(acceptRes.statusCode, 200, acceptRes.body?.message);
  const battleId = acceptRes.body.battle.id;
  assert.equal(acceptRes.body.battle.status, "live");

  return { battleId, inviteId };
};

test.before(async () => {
  resetBattleSchemaCacheForTests();
  await ensureBattleSchema();
  await cleanupTestData();
  await seedUsers();
  await enableBattles();
});

test.beforeEach(async () => {
  await cleanupTestData();
  await seedUsers();
  await enableBattles();
});

test.after(async () => {
  await disableBattles();
  await cleanupTestData();
});

test("battle opponents lists same-level approved females excluding self", async () => {
  const res = createMockRes();
  await listBattleOpponentsHandler(authReq(TEST_FEMALE_A), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body.opponents));
  assert.ok(Array.isArray(res.body.sameLevel));
  assert.ok(Array.isArray(res.body.recent));
  assert.ok(Array.isArray(res.body.favorites));
  assert.ok(
    res.body.opponents.some((opponent) => opponent.id === TEST_FEMALE_B)
  );
  assert.ok(
    !res.body.opponents.some((opponent) => opponent.id === TEST_FEMALE_A)
  );
});

test("battle opponents recent includes past battle opponent", async () => {
  await createAcceptedLiveBattle();

  const res = createMockRes();
  await listBattleOpponentsHandler(authReq(TEST_FEMALE_A), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(
    res.body.recent.some((opponent) => opponent.id === TEST_FEMALE_B),
    "expected recent opponents to include prior battle partner"
  );
});

test("battle invite accept join and gift updates fighter score atomically", async () => {
  const { battleId } = await createAcceptedLiveBattle();

  const audienceRes = createMockRes();
  await joinBattleAudienceHandler(
    authReq(TEST_MALE_ID, { battleId }),
    audienceRes
  );
  assert.equal(audienceRes.statusCode, 200, audienceRes.body?.message);

  const giftRes = createMockRes();
  await sendBattleGiftHandler(
    authReq(
      TEST_MALE_ID,
      { battleId },
      {
        receiverId: TEST_FEMALE_A,
        giftId: "heart_balloon",
        clientRequestId: `battle-test-${Date.now()}`,
      }
    ),
    giftRes
  );

  assert.equal(giftRes.statusCode, 201, giftRes.body?.message);
  assert.equal(giftRes.body.coinCost, 49);
  assert.equal(giftRes.body.scores.A, 49);

  const wallet = await Wallet.findOne({ where: { userId: TEST_MALE_ID } });
  assert.equal(Number(wallet.balance), 5000 - 49);

  const fighterA = await BattleFighter.findOne({
    where: { battleId, userId: TEST_FEMALE_A },
  });
  assert.equal(Number(fighterA.scoreCoins), 49);

  const giftRecord = await BattleGiftRecord.findOne({
    where: { battleId, senderId: TEST_MALE_ID },
  });
  assert.ok(giftRecord);
  assert.equal(giftRecord.fighterSlot, "A");

  const earning = await Earning.findOne({
    where: { userId: TEST_FEMALE_A },
    order: [["createdAt", "DESC"]],
  });
  assert.ok(earning);
  assert.equal(Number(earning.coins), giftRes.body.femaleCoins);
});

test("duplicate battle gift clientRequestId is idempotent", async () => {
  const { battleId } = await createAcceptedLiveBattle();

  const audienceRes = createMockRes();
  await joinBattleAudienceHandler(
    authReq(TEST_MALE_ID, { battleId }),
    audienceRes
  );
  assert.equal(audienceRes.statusCode, 200);

  const clientRequestId = `battle-dup-${Date.now()}`;

  const firstRes = createMockRes();
  await sendBattleGiftHandler(
    authReq(
      TEST_MALE_ID,
      { battleId },
      {
        receiverId: TEST_FEMALE_B,
        giftId: "heart_balloon",
        clientRequestId,
      }
    ),
    firstRes
  );
  assert.equal(firstRes.statusCode, 201);

  const walletAfterFirst = await Wallet.findOne({
    where: { userId: TEST_MALE_ID },
  });

  const secondRes = createMockRes();
  await sendBattleGiftHandler(
    authReq(
      TEST_MALE_ID,
      { battleId },
      {
        receiverId: TEST_FEMALE_B,
        giftId: "heart_balloon",
        clientRequestId,
      }
    ),
    secondRes
  );
  assert.equal(secondRes.statusCode, 201);
  assert.equal(secondRes.body.duplicate, true);

  const walletAfterSecond = await Wallet.findOne({
    where: { userId: TEST_MALE_ID },
  });
  assert.equal(Number(walletAfterSecond.balance), Number(walletAfterFirst.balance));

  const giftCount = await BattleGiftRecord.count({
    where: { battleId, clientRequestId },
  });
  assert.equal(giftCount, 1);
});

test("battle invite rejects different-level opponents with a 400", async () => {
  const call = await CallHistory.create({
    callerId: TEST_MALE_ID,
    receiverId: TEST_FEMALE_A,
    type: "voice",
    duration: 60,
    coinsSpent: 0,
    status: "ended",
  });

  await Earning.create({
    userId: TEST_FEMALE_A,
    callId: call.id,
    coins: 5000,
    amount: 0,
    duration: 60,
    status: "paid",
  });

  const res = createMockRes();
  await createBattleInviteHandler(
    authReq(
      TEST_FEMALE_A,
      {},
      { opponentId: TEST_FEMALE_B, durationSeconds: 120 }
    ),
    res
  );

  assert.equal(res.statusCode, 400, res.body?.message);
  assert.match(res.body.message, /level/i);

  await Earning.destroy({ where: { callId: call.id } });
  await call.destroy();
});

test("battle invite rejects male opponents", async () => {
  const res = createMockRes();
  await createBattleInviteHandler(
    authReq(
      TEST_FEMALE_A,
      {},
      { opponentId: TEST_MALE_ID, durationSeconds: 120 }
    ),
    res
  );

  assert.equal(res.statusCode, 400, res.body?.message);
  assert.match(res.body.message, /female/i);
});

test("accepting a battle clears leftover fighter locks from cancelled battles", async () => {
  const first = await createAcceptedLiveBattle();

  await BattleRoom.update(
    { status: "cancelled" },
    { where: { id: first.battleId } }
  );

  const leftover = await BattleFighter.count({
    where: {
      battleId: first.battleId,
      activeFighterGuard: {
        [Op.like]: "fighter:%",
      },
    },
  });
  assert.equal(leftover, 2);

  const inviteRes = createMockRes();
  await createBattleInviteHandler(
    authReq(
      TEST_FEMALE_A,
      {},
      { opponentId: TEST_FEMALE_B, durationSeconds: 120 }
    ),
    inviteRes
  );
  assert.equal(inviteRes.statusCode, 201, inviteRes.body?.message);

  const acceptRes = createMockRes();
  await acceptBattleInviteHandler(
    authReq(TEST_FEMALE_B, { inviteId: inviteRes.body.id }),
    acceptRes
  );

  assert.equal(acceptRes.statusCode, 200, acceptRes.body?.message);
  assert.equal(acceptRes.body.battle.status, "live");
});
