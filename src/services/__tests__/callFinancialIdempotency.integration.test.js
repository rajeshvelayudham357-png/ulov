import test from "node:test";
import assert from "node:assert/strict";

import { sequelize } from "../../config/database.js";
import { CallHistory } from "../../models/index.js";
import { completeCallRecord } from "../callState.service.js";
import {
  IDS,
  cleanupAllHarnessData,
  seedEligibleCreators,
  upsertTestUser,
} from "./helpers/qcTestHarness.js";

test.before(async () => {
  await cleanupAllHarnessData();
  await seedEligibleCreators();
  await upsertTestUser({ id: IDS.MALE, gender: "Male", online: true });
  await upsertTestUser({
    id: IDS.CREATOR_A,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: false,
  });
});

test.after(async () => {
  await cleanupAllHarnessData();
  await sequelize.close();
});

// Settlement derives the duration from the server's acceptedAt and pays the
// creator only from coins debited for the call, so tests seed both.
const seedCallDebit = async (callId, amount) => {
  const { WalletTransaction } = await import("../../models/index.js");
  await WalletTransaction.create({
    userId: IDS.MALE,
    type: "debit",
    amount,
    description: "Call charge",
    referenceType: "call",
    referenceId: callId,
  });
};

test("completeCallRecord second invocation returns alreadyCompleted", async () => {
  const history = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "live",
    acceptedAt: new Date(Date.now() - 65_000),
  });

  const first = await completeCallRecord({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 65,
    callHistoryId: history.id,
  });

  assert.equal(first.alreadyCompleted, false);
  assert.ok(first.billing.maleCost > 0);

  const second = await completeCallRecord({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 65,
    callHistoryId: history.id,
  });

  assert.equal(second.alreadyCompleted, true);
  assert.equal(second.billing.maleCost, first.billing.maleCost);

  await history.reload();
  assert.equal(history.status, "completed");
});

test("concurrent completeCallRecord settles once (single earning row)", async () => {
  const history = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "live",
    acceptedAt: new Date(Date.now() - 90_000),
  });
  await seedCallDebit(history.id, 1000);

  const payload = {
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 90,
    callHistoryId: history.id,
  };

  const [first, second] = await Promise.all([
    completeCallRecord(payload),
    completeCallRecord(payload),
  ]);

  const completedCount = [first, second].filter(
    (r) => r.alreadyCompleted === false
  ).length;
  const alreadyCount = [first, second].filter(
    (r) => r.alreadyCompleted === true
  ).length;

  assert.ok(
    completedCount >= 1,
    "at least one invocation must finalize"
  );
  assert.equal(
    completedCount + alreadyCount,
    2,
    "both invocations must return a result"
  );
  assert.equal(
    first.billing.maleCost,
    second.billing.maleCost,
    "billing math identical on both responses"
  );

  await history.reload();
  assert.equal(history.status, "completed");
  assert.equal(Number(history.coinsSpent), first.billing.maleCost);

  const { Earning } = await import("../../models/index.js");
  const earnings = await Earning.findAll({ where: { callId: history.id } });
  assert.equal(earnings.length, 1);

  const { WalletTransaction } = await import("../../models/index.js");
  await WalletTransaction.destroy({
    where: { referenceType: "call", referenceId: history.id },
  });
  await CallHistory.destroy({ where: { id: history.id } });
  await Earning.destroy({ where: { callId: history.id } });
});
