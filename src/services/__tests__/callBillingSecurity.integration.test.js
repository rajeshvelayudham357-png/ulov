/**
 * Phase 1 billing security: auth, forged ids, insufficient balance, idempotent
 * and concurrent settlement, and earnings capped at collected coins.
 *
 * Writes only rows with ids >= 882000 and removes them afterwards. Run against
 * a disposable schema, e.g. DB_NAME=ulov_billing_test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import express from "express";
import jwt from "jsonwebtoken";

import { sequelize } from "../../config/database.js";
import { CallHistory, Earning, Wallet, WalletTransaction } from "../../models/index.js";
import { ensureCallBillingSchema } from "../callBillingSchema.service.js";
import {
  getCreatorEarningPercentage,
  getCallRateSettings,
  updateCreatorCallRateSettings,
} from "../callRate.service.js";
import { getCallRatePerMinute } from "../callSettlement.service.js";
import { completeCallRecord } from "../callState.service.js";
import { getCallBillingReconciliation } from "../callBillingReconciliation.service.js";
import { spendWallet } from "../../controllers/wallet.controller.js";
import { saveCallHistory } from "../../controllers/callHistoryController.js";
import { createVideoCall } from "../../controllers/call.controller.js";
import walletRoutes from "../../routes/wallet.routes.js";
import callHistoryRoutes from "../../routes/callHistoryRoutes.js";
import callRoutes from "../../routes/call.routes.js";
import {
  createMockRes,
  upsertTestUser,
  upsertTestWallet,
  withQuickConnectEnabled,
} from "./helpers/qcTestHarness.js";

const PREFIX = 882000;
const MALE = PREFIX + 1;
const OTHER_MALE = PREFIX + 2;
const CREATOR = PREFIX + 3;
const OTHER_CREATOR = PREFIX + 4;
const CUSTOM_CREATOR = PREFIX + 5;

let server;
let baseUrl;

const tokenFor = (id) => jwt.sign({ id, phone: `+88200${id}` }, process.env.JWT_SECRET);

const cleanup = async () => {
  const ids = [MALE, OTHER_MALE, CREATOR, OTHER_CREATOR, CUSTOM_CREATOR];
  const calls = await CallHistory.findAll({
    where: sequelize.literal(`callerId >= ${PREFIX} AND callerId < ${PREFIX + 100}`),
    attributes: ["id"],
  });
  const callIds = calls.map((row) => row.id);

  if (callIds.length) {
    await Earning.destroy({ where: { callId: callIds } });
  }

  await WalletTransaction.destroy({ where: { userId: ids } });
  await CallHistory.destroy({ where: { callerId: ids } });
  await Wallet.destroy({ where: { userId: ids } });
  await sequelize.query(
    "DELETE FROM creator_call_rate_settings WHERE userId IN (:ids)",
    { replacements: { ids } }
  ).catch(() => {});
  await sequelize.query(
    `DELETE FROM quick_connect_sessions WHERE callerId IN (:ids)`,
    { replacements: { ids } }
  ).catch(() => {});
  await sequelize.query("DELETE FROM users WHERE id IN (:ids)", {
    replacements: { ids },
  });
};

const createAcceptedCall = async ({
  callerId = MALE,
  receiverId = CREATOR,
  type = "voice",
  acceptedSecondsAgo = 125,
} = {}) =>
  CallHistory.create({
    callerId,
    receiverId,
    type,
    duration: 0,
    coinsSpent: 0,
    status: "accepted",
    acceptedAt: new Date(Date.now() - acceptedSecondsAgo * 1000),
  });

const spend = async ({ userId, amount, callId, bodyUserId }) => {
  const res = createMockRes();
  await spendWallet(
    {
      user: { id: userId },
      body: {
        ...(bodyUserId !== undefined ? { userId: bodyUserId } : { userId }),
        amount,
        ...(callId ? { callSessionId: callId, referenceId: callId, referenceType: "call" } : {}),
      },
    },
    res
  );
  return res;
};

const endCallAs = async (userId, body) => {
  const res = createMockRes();
  await saveCallHistory({ user: { id: userId }, body }, res);
  return res;
};

const walletBalance = async (userId) =>
  Number((await Wallet.findOne({ where: { userId } }))?.balance ?? 0);

const expectedEarnCoins = async (coins, creatorId = CREATOR) => {
  const settings = await getCallRateSettings();
  const pct = await getCreatorEarningPercentage(creatorId, settings.femaleEarningPercentage);
  return Math.floor(coins * (pct / 100));
};

test.before(async () => {
  await ensureCallBillingSchema({ force: true });
  await cleanup();

  await upsertTestUser({ id: MALE, gender: "Male", nickname: "Billing Male" });
  await upsertTestUser({ id: OTHER_MALE, gender: "Male", nickname: "Other Male" });
  await upsertTestUser({ id: CREATOR, gender: "Female", nickname: "Billing Creator" });
  await upsertTestUser({ id: OTHER_CREATOR, gender: "Female", nickname: "Other Creator" });
  await upsertTestUser({ id: CUSTOM_CREATOR, gender: "Female", nickname: "Custom Creator" });

  const app = express();
  app.use(express.json());
  app.use("/api/wallet", walletRoutes);
  app.use("/api/calls", callHistoryRoutes);
  app.use("/api/call", callRoutes);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await cleanup();
  await new Promise((resolve) => server.close(resolve));
  await sequelize.close();
});

const withCallCreateAuthMode = async (mode, fn) => {
  const previous = process.env.CALL_CREATE_AUTH_MODE;
  process.env.CALL_CREATE_AUTH_MODE = mode;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.CALL_CREATE_AUTH_MODE;
    } else {
      process.env.CALL_CREATE_AUTH_MODE = previous;
    }
  }
};

test("call create keeps old app builds working without a token in optional mode", async () => {
  await upsertTestWallet(MALE, 0);

  await withCallCreateAuthMode("optional", async () => {
    // Reaches the controller as the body caller: the balance check answers, not auth.
    const legacy = await fetch(`${baseUrl}/api/call/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callerId: MALE, receiverId: CREATOR, type: "voice" }),
    });
    assert.notEqual(legacy.status, 401);

    const noCaller = await fetch(`${baseUrl}/api/call/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiverId: CREATOR, type: "voice" }),
    });
    assert.equal(noCaller.status, 401);
  });
});

test("billing endpoints reject requests without a valid token", async () => {
  await withCallCreateAuthMode("required", async () => {
  for (const [path, body] of [
    ["/api/wallet/spend", { userId: MALE, amount: 10 }],
    ["/api/calls/end", { callerId: MALE, receiverId: CREATOR, duration: 60 }],
    ["/api/call/create", { callerId: MALE, receiverId: CREATOR, type: "voice" }],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 401, `${path} without token`);

    const forged = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt.sign({ id: MALE }, "not-the-secret")}`,
      },
      body: JSON.stringify(body),
    });
    assert.equal(forged.status, 401, `${path} with forged token`);
  }
  });

  // A forged token is refused even in optional mode.
  await withCallCreateAuthMode("optional", async () => {
    const forged = await fetch(`${baseUrl}/api/call/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt.sign({ id: MALE }, "not-the-secret")}`,
      },
      body: JSON.stringify({ callerId: MALE, receiverId: CREATOR, type: "voice" }),
    });
    assert.equal(forged.status, 401);
  });
});

test("legacy wallet recharge and call end endpoints are disabled", async () => {
  await upsertTestWallet(MALE, 0);

  const recharge = await fetch(`${baseUrl}/api/wallet/recharge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenFor(MALE)}`,
    },
    body: JSON.stringify({ userId: MALE, amount: 100000 }),
  });
  assert.equal(recharge.status, 410);
  assert.equal(await walletBalance(MALE), 0);

  const legacyEnd = await fetch(`${baseUrl}/api/call/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callerId: MALE, receiverId: CREATOR, duration: 3600, type: "video" }),
  });
  assert.equal(legacyEnd.status, 410);
  assert.equal(await walletBalance(MALE), 0);
  assert.equal(await Earning.count({ where: { userId: CREATOR } }), 0);
});

test("spend rejects forged user ids, other callers' calls and oversized amounts", async () => {
  await upsertTestWallet(MALE, 1000);
  await upsertTestWallet(OTHER_MALE, 1000);
  const call = await createAcceptedCall({ callerId: MALE });
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });

  const forged = await spend({ userId: MALE, bodyUserId: OTHER_MALE, amount: 10 });
  assert.equal(forged.statusCode, 403);

  const notMine = await spend({ userId: OTHER_MALE, amount: voiceRate, callId: call.id });
  assert.equal(notMine.statusCode, 403);

  const tooLarge = await spend({ userId: MALE, amount: 100_000, callId: call.id });
  assert.equal(tooLarge.statusCode, 400);

  const fractional = await spend({ userId: MALE, amount: 1.5, callId: call.id });
  assert.equal(fractional.statusCode, 400);

  assert.equal(await walletBalance(MALE), 1000);
  assert.equal(await walletBalance(OTHER_MALE), 1000);
});

test("call end is refused for users who are not on the call", async () => {
  const call = await createAcceptedCall({ callerId: MALE, receiverId: CREATOR });

  const res = await endCallAs(OTHER_MALE, {
    callHistoryId: call.id,
    callerId: MALE,
    receiverId: CREATOR,
    duration: 3600,
  });

  assert.equal(res.statusCode, 403);
  await call.reload();
  assert.equal(call.status, "accepted");
  assert.equal(call.settledAt, null);
});

test("call create refuses a forged caller id", async () => {
  const res = createMockRes();
  await createVideoCall(
    { user: { id: OTHER_MALE }, body: { callerId: MALE, receiverId: CREATOR, type: "voice" } },
    res
  );
  assert.equal(res.statusCode, 403);
});

test("call create rejects callers who cannot pay the first interval", async () => {
  await upsertTestWallet(MALE, 0);

  const direct = createMockRes();
  await createVideoCall(
    { user: { id: MALE }, body: { callerId: MALE, receiverId: CREATOR, type: "video" } },
    direct
  );
  assert.equal(direct.statusCode, 402);
  assert.equal(direct.body.code, "INSUFFICIENT_BALANCE");
  assert.equal(
    direct.body.required,
    Math.ceil((await getCallRatePerMinute({ type: "video", receiverId: CREATOR })) / 2)
  );

  await withQuickConnectEnabled(true, async () => {
    const quickConnect = createMockRes();
    await createVideoCall(
      { user: { id: MALE }, body: { callerId: MALE, type: "voice", mode: "quick_connect" } },
      quickConnect
    );
    assert.equal(quickConnect.statusCode, 402);
    assert.equal(quickConnect.body.code, "INSUFFICIENT_BALANCE");
  });

  const [{ sessions }] = await sequelize.query(
    "SELECT COUNT(*) AS sessions FROM quick_connect_sessions WHERE callerId = :callerId",
    { replacements: { callerId: MALE }, type: "SELECT" }
  );
  assert.equal(Number(sessions), 0, "no Quick Connect session is created");
});

test("per-creator rate overrides drive the initial charge and the spend cap", async () => {
  await updateCreatorCallRateSettings(CUSTOM_CREATOR, { voiceRatePerMinute: 37, videoRatePerMinute: 91 });
  await upsertTestWallet(MALE, 45);

  const res = createMockRes();
  await createVideoCall(
    { user: { id: MALE }, body: { callerId: MALE, receiverId: CUSTOM_CREATOR, type: "video" } },
    res
  );
  // 45 coins covers the custom video half-minute (46) only if the override is ignored.
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.required, 46);

  const call = await createAcceptedCall({ callerId: MALE, receiverId: CUSTOM_CREATOR, type: "video" });
  const overCap = await spend({ userId: MALE, amount: 92, callId: call.id });
  assert.equal(overCap.statusCode, 400);
  const atCap = await spend({ userId: MALE, amount: 45, callId: call.id });
  assert.equal(atCap.statusCode, 200);
});

test("settlement ignores client duration and pays only collected coins", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 10);
  const call = await createAcceptedCall({ acceptedSecondsAgo: 125 });

  for (let i = 0; i < 3; i += 1) {
    const charged = await spend({ userId: MALE, amount: voiceRate, callId: call.id });
    assert.equal(charged.statusCode, 200);
  }

  const res = await endCallAs(CREATOR, {
    callHistoryId: call.id,
    callerId: 1,
    receiverId: 1,
    duration: 99_999,
    coinsSpent: 999_999,
  });

  assert.equal(res.statusCode, 200);
  await call.reload();
  assert.ok(call.duration >= 124 && call.duration <= 130, `duration ${call.duration}`);
  assert.equal(call.coinsSpent, voiceRate * 3);
  assert.equal(call.collectedCoins, voiceRate * 3);
  assert.ok(call.settledAt);

  const earning = await Earning.findOne({ where: { callId: call.id } });
  assert.equal(earning.coins, await expectedEarnCoins(voiceRate * 3));
});

test("earnings are capped at collected coins and absent when nothing was collected", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 10);

  // 585 s stays inside minute 10 even on a slow run (DB times are whole seconds).
  const partlyPaid = await createAcceptedCall({ acceptedSecondsAgo: 585 });
  await spend({ userId: MALE, amount: voiceRate, callId: partlyPaid.id });
  await endCallAs(MALE, { callHistoryId: partlyPaid.id });
  await partlyPaid.reload();
  assert.equal(partlyPaid.coinsSpent, voiceRate * 10);
  const partlyPaidEarning = await Earning.findOne({ where: { callId: partlyPaid.id } });
  assert.equal(partlyPaidEarning.coins, await expectedEarnCoins(voiceRate));

  const unpaid = await createAcceptedCall({ acceptedSecondsAgo: 600 });
  const unpaidEnd = await endCallAs(CREATOR, { callHistoryId: unpaid.id });
  assert.equal(unpaidEnd.statusCode, 200);
  assert.equal(await Earning.count({ where: { callId: unpaid.id } }), 0);
});

test("duplicate and concurrent call endings settle exactly once", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 10);
  const call = await createAcceptedCall({ acceptedSecondsAgo: 70 });
  await spend({ userId: MALE, amount: voiceRate, callId: call.id });
  await spend({ userId: MALE, amount: voiceRate, callId: call.id });
  const balanceBefore = await walletBalance(MALE);

  const results = await Promise.all([
    endCallAs(MALE, { callHistoryId: call.id }),
    endCallAs(CREATOR, { callHistoryId: call.id }),
    endCallAs(MALE, { callHistoryId: call.id }),
  ]);

  assert.ok(results.every((res) => res.statusCode === 200));
  assert.equal(results.filter((res) => res.body.alreadyCompleted === false).length, 1);
  assert.equal(await Earning.count({ where: { callId: call.id } }), 1);

  await call.reload();
  const settledAt = call.settledAt.getTime();
  const firstEarning = (await Earning.findOne({ where: { callId: call.id } })).coins;

  const again = await endCallAs(CREATOR, { callHistoryId: call.id, duration: 5000 });
  assert.equal(again.body.alreadyCompleted, true);
  await call.reload();
  assert.equal(call.settledAt.getTime(), settledAt);
  assert.equal((await Earning.findOne({ where: { callId: call.id } })).coins, firstEarning);
  assert.equal(await walletBalance(MALE), balanceBefore);
});

test("a charge arriving after settlement raises the earning up to the recorded cost", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 10);
  const call = await createAcceptedCall({ acceptedSecondsAgo: 125 });

  await spend({ userId: MALE, amount: voiceRate, callId: call.id });
  await endCallAs(CREATOR, { callHistoryId: call.id });
  assert.equal(
    (await Earning.findOne({ where: { callId: call.id } })).coins,
    await expectedEarnCoins(voiceRate)
  );

  // The 125 s call costs 3 minutes; late charges may fill that, not more.
  for (let i = 0; i < 2; i += 1) {
    const late = await spend({ userId: MALE, amount: voiceRate, callId: call.id });
    assert.equal(late.statusCode, 200);
  }

  const balanceBefore = await walletBalance(MALE);
  const beyond = await spend({ userId: MALE, amount: voiceRate, callId: call.id });
  assert.equal(beyond.statusCode, 409);
  assert.equal(beyond.body.code, "CALL_ALREADY_PAID");
  assert.equal(await walletBalance(MALE), balanceBefore, "refused charge is not debited");

  await call.reload();
  assert.equal(call.collectedCoins, voiceRate * 3);
  assert.equal(
    (await Earning.findOne({ where: { callId: call.id } })).coins,
    await expectedEarnCoins(voiceRate * 3),
    "raised to the 3-minute recorded cost"
  );
});

test("catch-up charges after the app was in the background are accepted up to real call time", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 20);
  // Charged minute 1, then the app slept; 4 m 10 s have really passed.
  const call = await createAcceptedCall({ acceptedSecondsAgo: 250 });
  assert.equal((await spend({ userId: MALE, amount: voiceRate, callId: call.id })).statusCode, 200);

  for (let minute = 2; minute <= 5; minute += 1) {
    const res = await spend({ userId: MALE, amount: voiceRate, callId: call.id });
    assert.equal(res.statusCode, 200, `minute ${minute}`);
  }

  const sixth = await spend({ userId: MALE, amount: voiceRate, callId: call.id });
  assert.equal(sixth.statusCode, 409, "cannot prepay beyond the current minute");
  assert.equal(await walletBalance(MALE), voiceRate * 15);
});

test("concurrent charges never overdraw a wallet", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 2);
  const call = await createAcceptedCall({ acceptedSecondsAgo: 300 });

  const results = await Promise.all(
    Array.from({ length: 6 }, () => spend({ userId: MALE, amount: voiceRate, callId: call.id }))
  );

  assert.equal(results.filter((res) => res.statusCode === 200).length, 2);
  assert.equal(await walletBalance(MALE), 0);

  const debits = await WalletTransaction.sum("amount", {
    where: { userId: MALE, referenceType: "call", referenceId: call.id },
  });
  assert.equal(Number(debits), voiceRate * 2);
});

test("calls settled before Phase 1 are left untouched", async () => {
  const legacy = await CallHistory.create({
    callerId: MALE,
    receiverId: CREATOR,
    type: "video",
    duration: 600,
    coinsSpent: 600,
    status: "completed",
  });
  await Earning.create({
    userId: CREATOR,
    callId: legacy.id,
    coins: 210,
    amount: 90.5,
    duration: 10,
    status: "pending",
  });

  const result = await completeCallRecord({
    callerId: MALE,
    receiverId: CREATOR,
    type: "video",
    duration: 99_999,
    callHistoryId: legacy.id,
  });

  assert.equal(result.alreadyCompleted, true);
  assert.equal(result.legacy, true);
  await legacy.reload();
  assert.equal(legacy.duration, 600);
  assert.equal(legacy.coinsSpent, 600);
  assert.equal(legacy.settledAt, null);
  const earning = await Earning.findOne({ where: { callId: legacy.id } });
  assert.equal(earning.coins, 210);
  assert.equal(Number(earning.amount), 90.5);
});

test("reconciliation report lists uncollected calls without modifying data", async () => {
  const before = await CallHistory.count();
  const report = await getCallBillingReconciliation({
    callerId: MALE,
    from: new Date(Date.now() - 3600_000),
    to: new Date(Date.now() + 60_000),
  });

  assert.ok(report.summary.calls >= 1);
  assert.ok(report.summary.uncollectedCoins > 0);
  assert.ok(report.rows.every((row) => row.callerId === MALE));
  assert.ok(report.rows.every((row) => row.recordedCost > row.collectedCoins));
  assert.equal(await CallHistory.count(), before);
});
