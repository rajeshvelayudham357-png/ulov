/**
 * Phase 2 server-authoritative billing: interval schedule, debits, face-gate
 * pauses, insufficient balance, heartbeats, restart recovery, duplicate
 * protection, shadow mode and the client/server mode switch.
 *
 * Writes only rows with ids >= 885000 and removes them afterwards. Run against
 * a disposable schema, e.g. DB_NAME=ulov_billing_test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { QueryTypes } from "sequelize";

import { sequelize } from "../../config/database.js";
import { CallHistory, Earning, Wallet, WalletTransaction } from "../../models/index.js";
import { ensureCallBillingSchema } from "../callBillingSchema.service.js";
import {
  chargeCallInterval,
  createCallBillingEngine,
  getPaidCoverage,
  resolveBillingModeForNewCall,
} from "../callBillingEngine.service.js";
import { getCallRatePerMinute } from "../callSettlement.service.js";
import { getCallRateSettings, getCreatorEarningPercentage } from "../callRate.service.js";
import {
  getDueIntervalCount,
  getIntervalAmount,
} from "../../utils/callBillingSchedule.util.js";
import { spendWallet } from "../../controllers/wallet.controller.js";
import { createVideoCall } from "../../controllers/call.controller.js";
import { createMockRes, upsertTestUser, upsertTestWallet } from "./helpers/qcTestHarness.js";

const PREFIX = 885000;
const MALE = PREFIX + 1;
const CREATOR = PREFIX + 2;
const IDS = [MALE, CREATOR];

let clock = Date.now();
const advance = (seconds) => {
  clock += seconds * 1000;
};

const withBillingMode = async (mode, fn) => {
  const previous = process.env.CALL_BILLING_MODE;
  process.env.CALL_BILLING_MODE = mode;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.CALL_BILLING_MODE;
    } else {
      process.env.CALL_BILLING_MODE = previous;
    }
  }
};

const makeEngine = (options = {}) => {
  const emitted = [];
  const engine = createCallBillingEngine({
    now: () => clock,
    emitToUser: (userId, event, payload) => emitted.push({ userId, event, payload }),
    ...options,
  });
  return { engine, emitted };
};

const cleanup = async () => {
  const calls = await CallHistory.findAll({
    where: sequelize.literal(`callerId >= ${PREFIX} AND callerId < ${PREFIX + 100}`),
    attributes: ["id"],
  });
  const callIds = calls.map((row) => row.id);

  if (callIds.length) {
    await Earning.destroy({ where: { callId: callIds } });
    await sequelize.query("DELETE FROM call_billing_intervals WHERE callId IN (:callIds)", {
      replacements: { callIds },
    });
    await CallHistory.destroy({ where: { id: callIds } });
  }

  await WalletTransaction.destroy({ where: { userId: IDS } });
  await Wallet.destroy({ where: { userId: IDS } });
  await sequelize.query("DELETE FROM users WHERE id IN (:ids)", { replacements: { ids: IDS } });
};

const createBilledCall = async ({ type = "voice", billingMode = "server", rate } = {}) => {
  const ratePerMinute = rate ?? (await getCallRatePerMinute({ type, receiverId: CREATOR }));
  return CallHistory.create({
    callerId: MALE,
    receiverId: CREATOR,
    type,
    duration: 0,
    coinsSpent: 0,
    status: "accepted",
    acceptedAt: new Date(clock),
    billingMode,
    billingRatePerMinute: ratePerMinute,
    billableSeconds: 0,
  });
};

const intervalsFor = async (callId, shadow = 0) =>
  sequelize.query(
    "SELECT intervalIndex, amount, shadow FROM call_billing_intervals WHERE callId = :callId AND shadow = :shadow ORDER BY intervalIndex",
    { replacements: { callId, shadow }, type: QueryTypes.SELECT }
  );

const balanceOf = async (userId) =>
  Number((await Wallet.findOne({ where: { userId } }))?.balance ?? 0);

const ledgerTotal = async (callId) =>
  Number(
    (await WalletTransaction.sum("amount", {
      where: { userId: MALE, referenceType: "call", referenceId: callId },
    })) || 0
  );

/** Advances the fake clock second by second, ticking like the real 1 s timer. */
const runFor = async (engine, seconds, beforeEachTick) => {
  for (let i = 0; i < seconds; i += 1) {
    advance(1);
    beforeEachTick?.();
    await engine.tick();
  }
};

test.before(async () => {
  await ensureCallBillingSchema({ force: true });
  await cleanup();
  await upsertTestUser({ id: MALE, gender: "Male", nickname: "Server Billing Male" });
  await upsertTestUser({ id: CREATOR, gender: "Female", nickname: "Server Billing Creator" });
});

test.after(async () => {
  await cleanup();
  await sequelize.close();
});

test("interval schedule matches the app's prepaid schedule", () => {
  assert.equal(getDueIntervalCount("voice", 0), 1);
  assert.equal(getDueIntervalCount("voice", 59), 1);
  assert.equal(getDueIntervalCount("voice", 60), 2);
  assert.equal(getDueIntervalCount("voice", 185), 4);

  assert.equal(getDueIntervalCount("video", 0), 1);
  assert.equal(getDueIntervalCount("video", 29), 1);
  assert.equal(getDueIntervalCount("video", 30), 2);
  assert.equal(getDueIntervalCount("video", 59), 2);
  assert.equal(getDueIntervalCount("video", 60), 3);
  assert.equal(getDueIntervalCount("video", 125), 4);

  assert.equal(getIntervalAmount("video", 0, 41), 21);
  assert.equal(getIntervalAmount("video", 1, 41), 21);
  assert.equal(getIntervalAmount("video", 2, 41), 41);
  assert.equal(getIntervalAmount("voice", 0, 20), 20);
});

test("billing mode follows the flag and the app's capability", async () => {
  await withBillingMode("client", async () => {
    assert.equal(resolveBillingModeForNewCall({ capability: "server" }), "client");
  });
  await withBillingMode("shadow", async () => {
    assert.equal(resolveBillingModeForNewCall({ capability: null }), "shadow");
  });
  await withBillingMode("server", async () => {
    assert.equal(resolveBillingModeForNewCall({ capability: "server" }), "server");
    assert.equal(resolveBillingModeForNewCall({ capability: null }), "client", "old builds keep phone billing");
  });
});

test("call create reports the billing mode and stores the rate snapshot", async () => {
  await upsertTestWallet(MALE, 10_000);
  await upsertTestUser({ id: CREATOR, gender: "Female", nickname: "Server Billing Creator", online: true });

  const create = async (body) => {
    const res = createMockRes();
    await createVideoCall({ user: { id: MALE }, body: { receiverId: CREATOR, type: "voice", ...body } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const row = await CallHistory.findByPk(res.body.callId);
    await row.update({ status: "cancelled" });
    return { body: res.body, row };
  };

  await withBillingMode("server", async () => {
    const modern = await create({ billingCapability: "server" });
    assert.equal(modern.body.billingMode, "server");
    assert.equal(modern.row.billingMode, "server");
    assert.equal(
      Number(modern.row.billingRatePerMinute),
      await getCallRatePerMinute({ type: "voice", receiverId: CREATOR })
    );

    const legacy = await create({});
    assert.equal(legacy.body.billingMode, "client");
  });

  await withBillingMode("client", async () => {
    const off = await create({ billingCapability: "server" });
    assert.equal(off.body.billingMode, "client");
  });
});

test("voice call is charged one prepaid minute at a time by the server", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 10);
  const call = await createBilledCall({ type: "voice" });
  const { engine, emitted } = makeEngine();

  await engine.sync();
  await engine.tick();
  assert.equal(await balanceOf(MALE), rate * 9, "minute 1 prepaid at accept");

  const heartbeat = () => engine.recordHeartbeat({ callId: call.id, userId: MALE });
  await runFor(engine, 59, heartbeat);
  assert.equal(await balanceOf(MALE), rate * 9);

  await runFor(engine, 1, heartbeat);
  assert.equal(await balanceOf(MALE), rate * 8, "minute 2 at 60 s");

  await runFor(engine, 65, heartbeat);
  assert.equal(await balanceOf(MALE), rate * 7, "minute 3 at 120 s");

  assert.deepEqual(
    (await intervalsFor(call.id)).map((row) => row.intervalIndex),
    [0, 1, 2]
  );
  assert.equal(await ledgerTotal(call.id), rate * 3);
  assert.ok(emitted.some((e) => e.event === "wallet-updated" && e.userId === MALE));

  await call.update({ status: "completed" });
});

test("video call pauses while the creator's face is missing with the restriction on", async () => {
  const rate = await getCallRatePerMinute({ type: "video", receiverId: CREATOR });
  const half = Math.max(1, Math.ceil(rate / 2));
  await upsertTestWallet(MALE, rate * 10);
  const call = await createBilledCall({ type: "video" });
  const { engine } = makeEngine();
  const heartbeat = () => engine.recordHeartbeat({ callId: call.id, userId: MALE });

  await engine.sync();
  await engine.tick();
  assert.equal(await balanceOf(MALE), rate * 10 - half, "first half at accept");

  engine.recordFaceStatus({ creatorId: CREATOR, callerId: MALE, faceDetected: false });
  await runFor(engine, 120, heartbeat);
  assert.equal(await balanceOf(MALE), rate * 10 - half, "no charge while face missing");

  engine.recordFaceRestrict({ callerId: MALE, creatorId: CREATOR, restrictEnabled: false });
  await runFor(engine, 30, heartbeat);
  assert.equal(await balanceOf(MALE), rate * 10 - 2 * half, "restriction off: billing resumes");

  engine.recordFaceRestrict({ callerId: MALE, creatorId: CREATOR, restrictEnabled: true });
  engine.recordFaceStatus({ creatorId: CREATOR, callerId: MALE, faceDetected: true });
  await runFor(engine, 30, heartbeat);
  assert.equal(await balanceOf(MALE), rate * 10 - 2 * half - Math.ceil(rate));

  await call.update({ status: "completed" });
});

test("a face-check pause does not keep a call open once the male cannot pay", async () => {
  const rate = await getCallRatePerMinute({ type: "video", receiverId: CREATOR });
  const half = Math.max(1, Math.ceil(rate / 2));
  await upsertTestWallet(MALE, half);
  const call = await createBilledCall({ type: "video" });
  const { engine, emitted } = makeEngine();
  const heartbeat = () => engine.recordHeartbeat({ callId: call.id, userId: MALE });

  await engine.sync();
  await engine.tick();
  assert.equal(await balanceOf(MALE), 0, "first half paid, nothing left");

  engine.recordFaceStatus({ creatorId: CREATOR, callerId: MALE, faceDetected: false });
  await runFor(engine, 25, heartbeat);
  await call.reload();
  assert.equal(call.status, "accepted", "still inside the paid 30 s");

  await runFor(engine, 12, heartbeat);
  await call.reload();
  assert.equal(call.status, "completed");
  assert.equal(call.endReason, "insufficient_balance");
  assert.ok(emitted.some((e) => e.event === "call-billing-ended" && e.userId === MALE));
});

test("a face-check pause keeps the call open while the male can still pay", async () => {
  const rate = await getCallRatePerMinute({ type: "video", receiverId: CREATOR });
  const half = Math.max(1, Math.ceil(rate / 2));
  await upsertTestWallet(MALE, half * 2);
  const call = await createBilledCall({ type: "video" });
  const { engine } = makeEngine();
  const heartbeat = () => engine.recordHeartbeat({ callId: call.id, userId: MALE });

  await engine.sync();
  await engine.tick();
  engine.recordFaceStatus({ creatorId: CREATOR, callerId: MALE, faceDetected: false });
  await runFor(engine, 60, heartbeat);

  await call.reload();
  assert.equal(call.status, "accepted");
  assert.equal(await balanceOf(MALE), half, "paused: second half not charged yet");

  await call.update({ status: "completed" });
});

test("insufficient balance ends the call, settles once and tells both apps", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 2);
  const call = await createBilledCall({ type: "voice" });
  const { engine, emitted } = makeEngine();
  const heartbeat = () => engine.recordHeartbeat({ callId: call.id, userId: MALE });

  await engine.sync();
  await engine.tick();
  await runFor(engine, 120, heartbeat);

  await call.reload();
  assert.equal(call.status, "completed");
  assert.equal(call.endReason, "insufficient_balance");
  assert.ok(call.settledAt);
  assert.equal(call.collectedCoins, rate * 2);
  assert.equal(Number(call.coinsSpent), rate * 2);
  assert.equal(await balanceOf(MALE), 0, "never negative");

  const settings = await getCallRateSettings();
  const pct = await getCreatorEarningPercentage(CREATOR, settings.femaleEarningPercentage);
  const earning = await Earning.findOne({ where: { callId: call.id } });
  assert.equal(earning.coins, Math.floor(rate * 2 * (pct / 100)));

  const ended = emitted.filter((e) => e.event === "call-billing-ended");
  assert.deepEqual(ended.map((e) => e.userId).sort(), [MALE, CREATOR].sort());
  assert.equal(ended[0].payload.reason, "insufficient_balance");
  assert.equal(engine.sessions.size, 0);
});

test("the same interval can never be debited twice", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 10);
  const call = await createBilledCall({ type: "voice" });

  const results = await Promise.all(
    Array.from({ length: 6 }, () => chargeCallInterval({ callId: call.id, intervalIndex: 0 }))
  );
  assert.equal(results.filter((r) => r.charged).length, 1);
  assert.equal(await balanceOf(MALE), rate * 9);

  // Two engines (e.g. overlapping processes) billing the same call.
  const first = makeEngine().engine;
  const second = makeEngine().engine;
  await Promise.all([first.sync(), second.sync()]);
  advance(65);
  first.recordHeartbeat({ callId: call.id, userId: MALE });
  second.recordHeartbeat({ callId: call.id, userId: MALE });
  await Promise.all([first.tick(), second.tick(), first.tick(), second.tick()]);

  assert.deepEqual((await intervalsFor(call.id)).map((r) => r.intervalIndex), [0, 1]);
  assert.equal(await balanceOf(MALE), rate * 8);
  assert.equal(await ledgerTotal(call.id), rate * 2);

  await call.update({ status: "completed" });
});

test("phone charges for a server-billed call are ignored", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 5);
  const call = await createBilledCall({ type: "voice" });

  const res = createMockRes();
  await spendWallet(
    { user: { id: MALE }, body: { userId: MALE, amount: rate, callSessionId: call.id } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.serverBilled, true);
  assert.equal(await balanceOf(MALE), rate * 5, "no double charge");
  assert.equal(await ledgerTotal(call.id), 0);

  await call.update({ status: "completed" });
});

test("a call ends 90 s after the male app's last heartbeat", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 20);
  const call = await createBilledCall({ type: "voice" });
  const { engine, emitted } = makeEngine();

  await engine.sync();
  let second = 0;
  await runFor(engine, 120, () => {
    second += 1;
    if (second % 15 === 0) {
      engine.recordHeartbeat({ callId: call.id, userId: MALE });
    }
  });
  await call.reload();
  assert.equal(call.status, "accepted", "regular heartbeats keep it going");

  await runFor(engine, 92);
  await call.reload();
  assert.equal(call.status, "completed");
  assert.equal(call.endReason, "heartbeat_timeout");
  assert.ok(emitted.some((e) => e.event === "call-billing-ended" && e.payload.reason === "heartbeat_timeout"));
});

test("the creator's heartbeat is enforced only once her app has sent one", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 20);
  const call = await createBilledCall({ type: "voice" });
  const { engine } = makeEngine();
  const maleHeartbeat = () => engine.recordHeartbeat({ callId: call.id, userId: MALE });

  await engine.sync();
  await runFor(engine, 150, maleHeartbeat);
  await call.reload();
  assert.equal(call.status, "accepted", "old creator builds send no heartbeat");

  engine.recordHeartbeat({ callId: call.id, userId: CREATOR });
  await runFor(engine, 92, maleHeartbeat);
  await call.reload();
  assert.equal(call.endReason, "heartbeat_timeout");
});

test("a restarted server resumes billing without charging again", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 20);
  const call = await createBilledCall({ type: "voice" });

  const before = makeEngine().engine;
  await before.sync();
  await runFor(before, 130, () => before.recordHeartbeat({ callId: call.id, userId: MALE }));
  assert.equal(await balanceOf(MALE), rate * 17);
  before.stop();

  // Simulated downtime is not billed; the new engine continues from the DB.
  advance(30);
  const after = makeEngine().engine;
  await after.sync();
  await after.tick();
  assert.equal(await balanceOf(MALE), rate * 17, "no re-charge after restart");

  await runFor(after, 60, () => after.recordHeartbeat({ callId: call.id, userId: MALE }));
  assert.equal(await balanceOf(MALE), rate * 16);
  assert.deepEqual((await intervalsFor(call.id)).map((r) => r.intervalIndex), [0, 1, 2, 3]);

  await call.update({ status: "completed" });
});

test("shadow mode records what it would charge without debiting", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 5);
  const call = await createBilledCall({ type: "voice", billingMode: "shadow" });
  const { engine, emitted } = makeEngine();

  await engine.sync();
  await runFor(engine, 130); // no heartbeats: shadow never ends a call

  assert.equal(await balanceOf(MALE), rate * 5);
  assert.deepEqual((await intervalsFor(call.id, 1)).map((r) => r.intervalIndex), [0, 1, 2]);
  assert.equal((await intervalsFor(call.id, 0)).length, 0);
  await call.reload();
  assert.equal(call.status, "accepted");
  assert.equal(emitted.filter((e) => e.event === "call-billing-ended").length, 0);

  await call.update({ status: "completed" });
});

test("paid coverage is derived from the coins collected so far", () => {
  assert.deepEqual(getPaidCoverage("voice", 20, 0), { paidUntilSecond: 0, nextAmount: 20 });
  assert.deepEqual(getPaidCoverage("voice", 20, 40), { paidUntilSecond: 120, nextAmount: 20 });
  assert.deepEqual(getPaidCoverage("video", 60, 30), { paidUntilSecond: 30, nextAmount: 30 });
  assert.deepEqual(getPaidCoverage("video", 60, 60), { paidUntilSecond: 60, nextAmount: 60 });
  assert.deepEqual(getPaidCoverage("video", 60, 119), { paidUntilSecond: 60, nextAmount: 60 });
});

test("a phone-billed call whose minimized app stopped paying is ended by the server", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate);
  const call = await createBilledCall({ type: "voice", billingMode: "client" });
  const { engine, emitted } = makeEngine();

  // The app paid minute 1 at connect, then was minimized and stopped charging.
  const res = createMockRes();
  await spendWallet({ user: { id: MALE }, body: { userId: MALE, amount: rate, callSessionId: call.id } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(await balanceOf(MALE), 0);

  advance(62);
  assert.deepEqual(await engine.enforcePhoneBilledCalls(), [], "inside the paid minute + grace");

  advance(2);
  assert.deepEqual(await engine.enforcePhoneBilledCalls(), [call.id]);

  await call.reload();
  assert.equal(call.status, "completed");
  assert.equal(call.endReason, "insufficient_balance");
  assert.equal(call.collectedCoins, rate);
  const ended = emitted.filter((e) => e.event === "call-billing-ended");
  assert.deepEqual(ended.map((e) => e.userId).sort(), [MALE, CREATOR].sort());
});

test("a minimized app is cut off when paid plus remaining coins run out, even if the next charge was affordable", async () => {
  // Replays call 30146: video at 60/min, 62 coins, first half paid, then minimized.
  const rate = 60;
  await upsertTestWallet(MALE, 62);
  const call = await createBilledCall({ type: "video", billingMode: "client", rate });
  const { engine, emitted } = makeEngine();

  const res = createMockRes();
  await spendWallet({ user: { id: MALE }, body: { userId: MALE, amount: 30, callSessionId: call.id } }, res);
  assert.equal(res.statusCode, 200);

  // 30 paid + 32 left covers both halves (to 60 s) but not minute 2.
  advance(45);
  assert.deepEqual(await engine.enforcePhoneBilledCalls(), [], "second half still affordable");

  advance(19);
  assert.deepEqual(await engine.enforcePhoneBilledCalls(), [call.id]);
  assert.ok(
    emitted.some((e) => e.event === "call-billing-ended" && e.userId === CREATOR),
    "creator's app is told to hang up"
  );
});

test("a phone-billed call is left alone while the male can still pay", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 5);
  const call = await createBilledCall({ type: "voice", billingMode: "client" });
  const { engine } = makeEngine();

  advance(300);
  assert.deepEqual(await engine.enforcePhoneBilledCalls(), []);
  await call.reload();
  assert.equal(call.status, "accepted");

  await call.update({ status: "completed" });
});

test("phone-billed calls are never touched by the server engine", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 5);
  const call = await createBilledCall({ type: "voice", billingMode: "client" });
  const { engine } = makeEngine();

  await engine.sync();
  await runFor(engine, 70);

  assert.equal(engine.sessions.has(call.id), false);
  assert.equal(await balanceOf(MALE), rate * 5);
  assert.equal((await intervalsFor(call.id)).length, 0);

  await call.update({ status: "completed" });
});

test("ending a server-billed call normally stops billing and settles collected coins", async () => {
  const rate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, rate * 10);
  const call = await createBilledCall({ type: "voice" });
  const { engine } = makeEngine();
  const heartbeat = () => engine.recordHeartbeat({ callId: call.id, userId: MALE });

  await engine.sync();
  await runFor(engine, 70, heartbeat);
  assert.equal(await balanceOf(MALE), rate * 8);

  const { completeCallRecord } = await import("../callState.service.js");
  await completeCallRecord({
    callerId: MALE,
    receiverId: CREATOR,
    type: "voice",
    callHistoryId: call.id,
    endedAt: new Date(clock),
  });

  await runFor(engine, 120, heartbeat);
  assert.equal(await balanceOf(MALE), rate * 8, "no charges after the call ended");

  await call.reload();
  assert.equal(call.collectedCoins, rate * 2);
  assert.equal(Number(call.coinsSpent), rate * 2);
});
