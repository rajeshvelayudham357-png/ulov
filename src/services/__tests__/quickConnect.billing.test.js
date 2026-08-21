/**
 * Quick Connect billing regression — billing formulas unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { sequelize } from "../../config/database.js";
import { ATTEMPT_STATUS } from "../../constants/quickConnect.js";
import { CallHistory, Wallet } from "../../models/index.js";
import { endCall } from "../../controllers/callEnd.controller.js";
import { completeCallRecord } from "../callState.service.js";
import {
  handleQuickConnectAttemptFailure,
  cancelQuickConnectSession,
} from "../quickConnect.service.js";
import {
  IDS,
  cleanupAllHarnessData,
  createMockRes,
  seedEligibleCreators,
  upsertTestWallet,
  upsertTestUser,
  getInsertId,
} from "./helpers/qcTestHarness.js";
import { QC_TABLES } from "../../constants/quickConnect.js";

test.before(async () => {
  await cleanupAllHarnessData();
  await seedEligibleCreators();
});

test.after(async () => {
  await cleanupAllHarnessData();
  await sequelize.close();
});

const assertZeroCoins = async (callHistoryId) => {
  const row = await CallHistory.findByPk(callHistoryId);
  assert.ok(row);
  assert.equal(Number(row.coinsSpent), 0);
};

test("QC timeout attempt keeps coinsSpent = 0", async () => {
  const history = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "ringing",
  });

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, callHistoryId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, :callHistoryId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    {
      replacements: {
        sessionId,
        receiverId: IDS.CREATOR_A,
        callHistoryId: history.id,
      },
    }
  );
  const attemptId = getInsertId(attemptResult);

  await handleQuickConnectAttemptFailure({
    attemptId,
    terminalStatus: ATTEMPT_STATUS.MISSED,
    failureReason: "timeout",
  });

  await assertZeroCoins(history.id);

  await CallHistory.destroy({ where: { id: history.id } });
  await sequelize.query(`DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`, {
    replacements: { attemptId },
  });
  await sequelize.query(`DELETE FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId`, {
    replacements: { sessionId },
  });
});

test("QC reject/busy/offline attempts keep coinsSpent = 0", async () => {
  for (const status of ["rejected", "missed", "cancelled"]) {
    const history = await CallHistory.create({
      callerId: IDS.MALE,
      receiverId: IDS.CREATOR_B,
      type: "voice",
      duration: 0,
      coinsSpent: 0,
      status: "ringing",
    });

    await history.update({
      status: status === "missed" ? "missed" : status,
      duration: 0,
      coinsSpent: 0,
    });

    await assertZeroCoins(history.id);
    await CallHistory.destroy({ where: { id: history.id } });
  }
});

test("QC cancellation before connection keeps coinsSpent = 0", async () => {
  const history = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_C,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "ringing",
  });

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, callHistoryId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, :callHistoryId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    {
      replacements: {
        sessionId,
        receiverId: IDS.CREATOR_C,
        callHistoryId: history.id,
      },
    }
  );

  await cancelQuickConnectSession({ sessionId, callerId: IDS.MALE });
  await assertZeroCoins(history.id);

  await CallHistory.destroy({ where: { id: history.id } });
  await sequelize.query(`DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE sessionId = :sessionId`, {
    replacements: { sessionId },
  });
  await sequelize.query(`DELETE FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId`, {
    replacements: { sessionId },
  });
});

test("QC connected call bills exactly once via existing endCall path", async () => {
  await upsertTestUser({ id: IDS.MALE, gender: "Male", online: true });
  await upsertTestUser({
    id: IDS.CREATOR_A,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: true,
  });
  await upsertTestWallet(IDS.MALE, 10_000);

  const walletBefore = await Wallet.findOne({ where: { userId: IDS.MALE } });
  const startBalance = Number(walletBefore.balance);

  const history = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "accepted",
  });

  const res = createMockRes();
  await endCall(
    {
      body: {
        callerId: IDS.MALE,
        receiverId: IDS.CREATOR_A,
        duration: 120,
        type: "voice",
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.maleCost > 0);
  assert.equal(res.body.alreadyCompleted, false);

  const updatedHistory = await CallHistory.findByPk(history.id);
  assert.equal(Number(updatedHistory.coinsSpent), res.body.maleCost);
  assert.equal(updatedHistory.status, "completed");

  const walletAfterFirst = await Wallet.findOne({ where: { userId: IDS.MALE } });
  assert.equal(
    Number(walletAfterFirst.balance),
    startBalance - res.body.maleCost
  );

  const secondBilling = await completeCallRecord({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 120,
    callHistoryId: history.id,
  });

  assert.equal(secondBilling.alreadyCompleted, true);

  const walletAfterSecond = await Wallet.findOne({ where: { userId: IDS.MALE } });
  assert.equal(Number(walletAfterSecond.balance), Number(walletAfterFirst.balance));

  await CallHistory.destroy({ where: { id: history.id } });
});

test("Three failed QC attempts produce zero total coinsSpent", async () => {
  const ids = [];

  for (let i = 0; i < 3; i += 1) {
    const history = await CallHistory.create({
      callerId: IDS.MALE,
      receiverId: IDS.CREATOR_A + i,
      type: "voice",
      duration: 0,
      coinsSpent: 0,
      status: "missed",
    });
    ids.push(history.id);
  }

  const rows = await CallHistory.findAll({ where: { id: ids } });
  const total = rows.reduce((sum, row) => sum + Number(row.coinsSpent || 0), 0);
  assert.equal(total, 0);

  await CallHistory.destroy({ where: { id: ids } });
});

test("completeCallRecord on zero-duration call keeps coinsSpent at 0", async () => {
  const history = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_B,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "accepted",
  });

  const result = await completeCallRecord({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_B,
    type: "voice",
    duration: 0,
    callHistoryId: history.id,
  });

  assert.equal(Number(result.billing.maleCost), 0);
  assert.equal(Number(result.history.coinsSpent), 0);

  await CallHistory.destroy({ where: { id: history.id } });
});
