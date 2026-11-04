/**
 * Phase 1.1: socket identity, participant authorization, accept-time balance
 * checks, disconnect settlement, duplicate endings, late charges on paid
 * earnings and Quick Connect attempt numbering.
 *
 * Writes only rows with ids >= 883000 and removes them afterwards. Run against
 * a disposable schema, e.g. DB_NAME=ulov_billing_test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import jwt from "jsonwebtoken";

import { sequelize } from "../../config/database.js";
import { ATTEMPT_STATUS, QC_TABLES } from "../../constants/quickConnect.js";
import { CallHistory, Earning, Wallet, WalletTransaction } from "../../models/index.js";
import { ensureCallBillingSchema } from "../callBillingSchema.service.js";
import { updateCreatorCallRateSettings } from "../callRate.service.js";
import { getCallRatePerMinute, markCallAccepted } from "../callSettlement.service.js";
import { completeCallRecord } from "../callState.service.js";
import { evaluateCallAcceptRequest } from "../callAccept.service.js";
import { handleParticipantDisconnect } from "../callDisconnect.service.js";
import {
  getNextAttemptNumber,
  tryAcceptQuickConnectAttempt,
} from "../quickConnect.service.js";
import {
  authorizeCallEvent,
  createSocketAuthMiddleware,
  getSocketActorId,
  resolveRegisterUserId,
} from "../socketAuth.service.js";
import { spendWallet } from "../../controllers/wallet.controller.js";
import { saveCallHistory } from "../../controllers/callHistoryController.js";
import {
  createMockRes,
  getInsertId,
  installMockRuntime,
  upsertTestUser,
  upsertTestWallet,
} from "./helpers/qcTestHarness.js";

const PREFIX = 883000;
const MALE = PREFIX + 1;
const OTHER_MALE = PREFIX + 2;
const CREATOR = PREFIX + 3;
const OTHER_CREATOR = PREFIX + 4;
const PRICEY_CREATOR = PREFIX + 5;
const ALL_IDS = [MALE, OTHER_MALE, CREATOR, OTHER_CREATOR, PRICEY_CREATOR];

const tokenFor = (id) => jwt.sign({ id, phone: `+88300${id}` }, process.env.JWT_SECRET);

const withSocketAuthMode = async (mode, fn) => {
  const previous = process.env.SOCKET_AUTH_MODE;
  process.env.SOCKET_AUTH_MODE = mode;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.SOCKET_AUTH_MODE;
    } else {
      process.env.SOCKET_AUTH_MODE = previous;
    }
  }
};

const connectSocket = (handshake = {}, mode) => {
  const socket = { handshake, data: {} };
  let error = null;
  createSocketAuthMiddleware({ mode })(socket, (err) => {
    error = err ?? null;
  });
  return { socket, error };
};

const cleanup = async () => {
  const calls = await CallHistory.findAll({
    where: sequelize.literal(
      `(callerId >= ${PREFIX} AND callerId < ${PREFIX + 100}) OR (receiverId >= ${PREFIX} AND receiverId < ${PREFIX + 100})`
    ),
    attributes: ["id"],
  });
  const callIds = calls.map((row) => row.id);

  if (callIds.length) {
    await Earning.destroy({ where: { callId: callIds } });
  }

  const sessions = await sequelize.query(
    `SELECT id FROM ${QC_TABLES.SESSIONS} WHERE callerId IN (:ids)`,
    { replacements: { ids: ALL_IDS }, type: "SELECT" }
  );
  const sessionIds = sessions.map((row) => row.id);

  if (sessionIds.length) {
    await sequelize.query(`DELETE FROM ${QC_TABLES.RESERVATIONS} WHERE sessionId IN (:sessionIds)`, {
      replacements: { sessionIds },
    }).catch(() => {});
    await sequelize.query(`DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE sessionId IN (:sessionIds)`, {
      replacements: { sessionIds },
    });
    await sequelize.query(`DELETE FROM ${QC_TABLES.SESSIONS} WHERE id IN (:sessionIds)`, {
      replacements: { sessionIds },
    });
  }

  await sequelize.query("DELETE FROM withdraws WHERE userId IN (:ids)", {
    replacements: { ids: ALL_IDS },
  }).catch(() => {});
  await WalletTransaction.destroy({ where: { userId: ALL_IDS } });
  if (callIds.length) {
    await CallHistory.destroy({ where: { id: callIds } });
  }
  await Wallet.destroy({ where: { userId: ALL_IDS } });
  await sequelize.query("DELETE FROM creator_call_rate_settings WHERE userId IN (:ids)", {
    replacements: { ids: ALL_IDS },
  }).catch(() => {});
  await sequelize.query("DELETE FROM users WHERE id IN (:ids)", {
    replacements: { ids: ALL_IDS },
  });
};

const createCall = async ({
  callerId = MALE,
  receiverId = CREATOR,
  type = "voice",
  status = "accepted",
  acceptedSecondsAgo = 125,
} = {}) =>
  CallHistory.create({
    callerId,
    receiverId,
    type,
    duration: 0,
    coinsSpent: 0,
    status,
    acceptedAt:
      acceptedSecondsAgo === null ? null : new Date(Date.now() - acceptedSecondsAgo * 1000),
  });

const spend = async ({ userId = MALE, amount, callId }) => {
  const res = createMockRes();
  await spendWallet(
    {
      user: { id: userId },
      body: { userId, amount, callSessionId: callId, referenceId: callId, referenceType: "call" },
    },
    res
  );
  return res;
};

const createRingingQuickConnectAttempt = async ({ receiverId, type = "voice", maxAttempts = 1 }) => {
  const history = await createCall({ receiverId, type, status: "ringing", acceptedSecondsAgo: null });
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, :type, 'quick_connect', 'routing', :maxAttempts, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: MALE, type, maxAttempts } }
  );
  const sessionId = getInsertId(sessionResult);
  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, callHistoryId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, :callHistoryId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    { replacements: { sessionId, receiverId, callHistoryId: history.id } }
  );
  return { history, sessionId, attemptId: getInsertId(attemptResult) };
};

const attemptStatus = async (attemptId) => {
  const [row] = await sequelize.query(
    `SELECT status, failureReason FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`,
    { replacements: { attemptId }, type: "SELECT" }
  );
  return row;
};

test.before(async () => {
  await ensureCallBillingSchema({ force: true });
  await cleanup();
  installMockRuntime();

  await upsertTestUser({ id: MALE, gender: "Male", nickname: "Lifecycle Male" });
  await upsertTestUser({ id: OTHER_MALE, gender: "Male", nickname: "Impostor Male" });
  await upsertTestUser({ id: CREATOR, gender: "Female", nickname: "Lifecycle Creator" });
  await upsertTestUser({ id: OTHER_CREATOR, gender: "Female", nickname: "Impostor Creator" });
  await upsertTestUser({ id: PRICEY_CREATOR, gender: "Female", nickname: "Pricey Creator" });
});

test.after(async () => {
  await cleanup();
  await sequelize.close();
});

// ---------------------------------------------------------------------------
// Socket identity
// ---------------------------------------------------------------------------

test("socket handshake binds the JWT user and rejects bad tokens only in required mode", () => {
  const viaAuth = connectSocket({ auth: { token: tokenFor(MALE) } }, "optional");
  assert.equal(viaAuth.error, null);
  assert.equal(viaAuth.socket.data.userId, String(MALE));
  assert.equal(viaAuth.socket.data.authenticated, true);

  const viaHeader = connectSocket({ headers: { authorization: `Bearer ${tokenFor(CREATOR)}` } }, "optional");
  assert.equal(viaHeader.socket.data.userId, String(CREATOR));

  const legacy = connectSocket({}, "optional");
  assert.equal(legacy.error, null, "old builds without a token still connect");
  assert.equal(legacy.socket.data.authenticated, false);

  const forged = connectSocket({ auth: { token: jwt.sign({ id: MALE }, "wrong-secret") } }, "optional");
  assert.equal(forged.error, null);
  assert.equal(forged.socket.data.userId, null, "a forged token is not trusted");

  const expired = connectSocket(
    { auth: { token: jwt.sign({ id: MALE }, process.env.JWT_SECRET, { expiresIn: -10 }) } },
    "optional"
  );
  assert.equal(expired.socket.data.userId, null);

  const refused = connectSocket({}, "required");
  assert.ok(refused.error);
  assert.equal(refused.error.data.code, "SOCKET_UNAUTHORIZED");

  const allowed = connectSocket({ auth: { token: tokenFor(MALE) } }, "required");
  assert.equal(allowed.error, null);
});

test("an authenticated socket cannot register as another user", () => {
  const { socket } = connectSocket({ auth: { token: tokenFor(OTHER_MALE) } }, "optional");
  assert.equal(resolveRegisterUserId(socket, MALE), String(OTHER_MALE));

  const legacy = connectSocket({}, "optional").socket;
  assert.equal(resolveRegisterUserId(legacy, MALE), String(MALE));
  legacy.data.registeredUserId = String(MALE);
  assert.equal(getSocketActorId(legacy), String(MALE));
});

test("call events are refused for impersonators and mismatched call ids", async () => {
  const call = await createCall({ status: "live", acceptedSecondsAgo: null });
  const otherPairCall = await createCall({
    callerId: OTHER_MALE,
    receiverId: OTHER_CREATOR,
    status: "live",
    acceptedSecondsAgo: null,
  });
  const payload = { callerId: String(MALE), receiverId: String(CREATOR), callId: String(call.id) };

  const impostorCreator = connectSocket({ auth: { token: tokenFor(OTHER_CREATOR) } }, "optional").socket;
  const accept = await authorizeCallEvent({ socket: impostorCreator, data: payload, role: "receiver" });
  assert.equal(accept.allowed, false);
  assert.equal(accept.reason, "not_participant");

  const impostorMale = connectSocket({ auth: { token: tokenFor(OTHER_MALE) } }, "optional").socket;
  const end = await authorizeCallEvent({ socket: impostorMale, data: payload, role: "participant" });
  assert.equal(end.allowed, false);

  const caller = connectSocket({ auth: { token: tokenFor(MALE) } }, "optional").socket;
  const callerAccepting = await authorizeCallEvent({ socket: caller, data: payload, role: "receiver" });
  assert.equal(callerAccepting.allowed, false, "the caller cannot accept their own call");

  const creator = connectSocket({ auth: { token: tokenFor(CREATOR) } }, "optional").socket;
  const mismatched = await authorizeCallEvent({
    socket: creator,
    data: { ...payload, callId: String(otherPairCall.id) },
    role: "receiver",
  });
  assert.equal(mismatched.allowed, false);
  assert.equal(mismatched.reason, "call_mismatch");

  assert.equal((await authorizeCallEvent({ socket: creator, data: payload, role: "receiver" })).allowed, true);
  assert.equal((await authorizeCallEvent({ socket: caller, data: payload, role: "participant" })).allowed, true);
  assert.equal((await authorizeCallEvent({ socket: creator, data: payload, role: "participant" })).allowed, true);
});

test("legacy sockets keep working in optional mode and are refused in required mode", async () => {
  const payload = { callerId: String(MALE), receiverId: String(CREATOR) };
  const legacy = connectSocket({}, "optional").socket;

  await withSocketAuthMode("optional", async () => {
    legacy.data.registeredUserId = String(CREATOR);
    assert.equal((await authorizeCallEvent({ socket: legacy, data: payload, role: "receiver" })).allowed, true);

    legacy.data.registeredUserId = String(OTHER_CREATOR);
    assert.equal((await authorizeCallEvent({ socket: legacy, data: payload, role: "receiver" })).allowed, false);
  });

  await withSocketAuthMode("required", async () => {
    const unregistered = connectSocket({}, "optional").socket;
    assert.equal(
      (await authorizeCallEvent({ socket: unregistered, data: payload, role: "participant" })).allowed,
      false
    );
  });
});

// ---------------------------------------------------------------------------
// Accept-time balance and concurrent acceptance
// ---------------------------------------------------------------------------

test("direct accept re-checks the caller's balance at the creator's rate", async () => {
  const defaultVoice = await getCallRatePerMinute({ type: "voice" });
  await updateCreatorCallRateSettings(PRICEY_CREATOR, {
    voiceRatePerMinute: defaultVoice * 3,
    videoRatePerMinute: defaultVoice * 6,
  });
  await upsertTestWallet(MALE, defaultVoice);

  const call = await createCall({ receiverId: PRICEY_CREATOR, status: "live", acceptedSecondsAgo: null });
  const payload = {
    callerId: String(MALE),
    receiverId: String(PRICEY_CREATOR),
    callId: String(call.id),
    mode: "direct",
  };

  const refused = await evaluateCallAcceptRequest(payload);
  assert.equal(refused.accepted, false);
  assert.equal(refused.reason, "insufficient_balance");

  await upsertTestWallet(MALE, defaultVoice * 3);
  const accepted = await evaluateCallAcceptRequest(payload);
  assert.equal(accepted.accepted, true);

  await CallHistory.update({ status: "cancelled" }, { where: { id: call.id } });
});

test("Quick Connect accept uses the routed creator's rate override", async () => {
  const defaultVoice = await getCallRatePerMinute({ type: "voice" });
  await updateCreatorCallRateSettings(PRICEY_CREATOR, {
    voiceRatePerMinute: defaultVoice * 3,
    videoRatePerMinute: defaultVoice * 6,
  });
  // Enough for the default rate used when the session was created, not for this creator.
  await upsertTestWallet(MALE, defaultVoice);

  const { history, attemptId } = await createRingingQuickConnectAttempt({ receiverId: PRICEY_CREATOR });

  const result = await tryAcceptQuickConnectAttempt({
    attemptId,
    callerId: MALE,
    receiverId: PRICEY_CREATOR,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "insufficient_balance");

  const attempt = await attemptStatus(attemptId);
  assert.equal(attempt.status, ATTEMPT_STATUS.FAILED);
  assert.equal(attempt.failureReason, "insufficient_balance");

  await history.reload();
  assert.equal(history.acceptedAt, null);
  assert.notEqual(history.status, "accepted");
  assert.equal(Number(history.coinsSpent), 0);

  await upsertTestWallet(MALE, defaultVoice * 3);
  const affordable = await createRingingQuickConnectAttempt({ receiverId: PRICEY_CREATOR });
  const ok = await tryAcceptQuickConnectAttempt({
    attemptId: affordable.attemptId,
    callerId: MALE,
    receiverId: PRICEY_CREATOR,
  });
  assert.equal(ok.accepted, true);
  await CallHistory.update({ status: "completed" }, { where: { id: affordable.history.id } });
});

test("concurrent accepts of one Quick Connect attempt succeed exactly once", async () => {
  await upsertTestWallet(MALE, 10_000);
  const { history, attemptId } = await createRingingQuickConnectAttempt({ receiverId: CREATOR });

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      tryAcceptQuickConnectAttempt({ attemptId, callerId: MALE, receiverId: CREATOR })
    )
  );

  assert.equal(results.filter((r) => r.accepted).length, 1);
  await history.reload();
  assert.ok(history.acceptedAt);
  const acceptedAt = history.acceptedAt.getTime();

  await markCallAccepted(history.id);
  await history.reload();
  assert.equal(history.acceptedAt.getTime(), acceptedAt, "acceptedAt is written once");

  await CallHistory.update({ status: "completed" }, { where: { id: history.id } });
});

// ---------------------------------------------------------------------------
// Disconnect settlement and duplicate endings
// ---------------------------------------------------------------------------

test("disconnect closes unanswered calls immediately and settles answered calls once after the grace period", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 10);

  const ringing = await createCall({ status: "live", acceptedSecondsAgo: null });
  const answered = await createCall({ acceptedSecondsAgo: 125 });
  await spend({ amount: voiceRate, callId: answered.id });
  await spend({ amount: voiceRate, callId: answered.id });

  const disconnectedAt = new Date(answered.acceptedAt.getTime() + 65_000);
  const { settlement } = await handleParticipantDisconnect({
    userId: MALE,
    onlineUsers: new Map(),
    graceMs: 500,
    now: () => disconnectedAt,
  });

  await ringing.reload();
  assert.equal(ringing.status, "completed", "unanswered call closed straight away");
  await answered.reload();
  assert.equal(answered.status, "accepted", "answered call survives the grace period");

  const outcome = await settlement;
  assert.equal(outcome.settled, 1);

  await answered.reload();
  assert.equal(answered.status, "completed");
  assert.equal(answered.endReason, "participant_disconnected");
  assert.ok(answered.settledAt);
  assert.ok(answered.duration >= 64 && answered.duration <= 66, `duration ${answered.duration}`);
  assert.equal(answered.collectedCoins, voiceRate * 2);
  assert.equal(await Earning.count({ where: { callId: answered.id } }), 1);
  assert.equal(Number(ringing.coinsSpent), 0);
});

test("a reconnect within the grace period keeps the call running", async () => {
  await upsertTestWallet(MALE, 10_000);
  const call = await createCall({ acceptedSecondsAgo: 30 });

  const onlineUsers = new Map();
  const { settlement } = await handleParticipantDisconnect({ userId: CREATOR, onlineUsers, graceMs: 200 });
  onlineUsers.set(String(CREATOR), "new-socket-id");

  const outcome = await settlement;
  assert.equal(outcome.skipped, "reconnected");
  await call.reload();
  assert.equal(call.status, "accepted");
  assert.equal(call.settledAt, null);

  await CallHistory.update({ status: "completed" }, { where: { id: call.id } });
});

test("disconnect settlement racing explicit endings pays the creator exactly once", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 10);
  const call = await createCall({ acceptedSecondsAgo: 95 });
  await spend({ amount: voiceRate, callId: call.id });
  await spend({ amount: voiceRate, callId: call.id });

  const endAs = async (userId) => {
    const res = createMockRes();
    await saveCallHistory({ user: { id: userId }, body: { callHistoryId: call.id } }, res);
    return res;
  };

  const results = await Promise.all([
    handleParticipantDisconnect({ userId: CREATOR, onlineUsers: new Map(), graceMs: 0 }).then(
      ({ settlement }) => settlement
    ),
    endAs(MALE),
    endAs(CREATOR),
    completeCallRecord({
      callerId: MALE,
      receiverId: CREATOR,
      type: "voice",
      callHistoryId: call.id,
      endReason: "socket_end",
    }),
  ]);

  assert.equal(await Earning.count({ where: { callId: call.id } }), 1);
  const firstSettlements = [results[1].body, results[2].body, results[3]].filter(
    (r) => r && r.alreadyCompleted === false
  ).length + (results[0]?.settled && results[0].settled > 0 ? 1 : 0);
  assert.ok(firstSettlements >= 1);

  await call.reload();
  const earning = await Earning.findOne({ where: { callId: call.id } });
  assert.ok(earning.coins > 0);
  assert.equal(call.collectedCoins, voiceRate * 2);

  const again = await completeCallRecord({
    callerId: MALE,
    receiverId: CREATOR,
    type: "voice",
    callHistoryId: call.id,
    duration: 9_999,
  });
  assert.equal(again.alreadyCompleted, true);
  assert.equal((await Earning.findOne({ where: { callId: call.id } })).coins, earning.coins);
});

// ---------------------------------------------------------------------------
// Late charges
// ---------------------------------------------------------------------------

test("late charges never modify a paid earning or existing withdrawals", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 10);
  const call = await createCall({ acceptedSecondsAgo: 185 });
  await spend({ amount: voiceRate, callId: call.id });
  await completeCallRecord({
    callerId: MALE,
    receiverId: CREATOR,
    type: "voice",
    callHistoryId: call.id,
  });

  const earning = await Earning.findOne({ where: { callId: call.id } });
  await earning.update({ status: "paid" });
  const paidCoins = earning.coins;
  const paidAmount = Number(earning.amount);

  await sequelize.query(
    `INSERT INTO withdraws (userId, amount, status, createdAt, updatedAt)
     VALUES (:userId, :amount, 'approved', NOW(), NOW())`,
    { replacements: { userId: CREATOR, amount: paidAmount } }
  );
  const [withdrawBefore] = await sequelize.query(
    "SELECT id, amount, status FROM withdraws WHERE userId = :userId ORDER BY id DESC LIMIT 1",
    { replacements: { userId: CREATOR }, type: "SELECT" }
  );

  const late = await spend({ amount: voiceRate, callId: call.id });
  assert.equal(late.statusCode, 200, "the debit itself is still recorded");

  await earning.reload();
  assert.equal(earning.status, "paid");
  assert.equal(earning.coins, paidCoins);
  assert.equal(Number(earning.amount), paidAmount);
  assert.equal(await Earning.count({ where: { callId: call.id } }), 1);

  const [withdrawAfter] = await sequelize.query(
    "SELECT id, amount, status FROM withdraws WHERE id = :id",
    { replacements: { id: withdrawBefore.id }, type: "SELECT" }
  );
  assert.deepEqual(withdrawAfter, withdrawBefore);
});

test("late charges on a pending earning stay capped at collected coins and recorded cost", async () => {
  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  await upsertTestWallet(MALE, voiceRate * 10);
  const call = await createCall({ acceptedSecondsAgo: 65 });
  await spend({ amount: voiceRate, callId: call.id });
  await completeCallRecord({ callerId: MALE, receiverId: CREATOR, type: "voice", callHistoryId: call.id });
  const settled = (await Earning.findOne({ where: { callId: call.id } })).coins;

  const results = await Promise.all(
    Array.from({ length: 4 }, () => spend({ amount: voiceRate, callId: call.id }))
  );
  // The 65 s call costs 2 minutes: only one more charge fits, even concurrently.
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  assert.ok(
    results
      .filter((r) => r.statusCode !== 200)
      .every((r) => r.statusCode === 409 && r.body.code === "CALL_ALREADY_PAID")
  );
  assert.equal(
    Number((await Wallet.findOne({ where: { userId: MALE } })).balance),
    voiceRate * 8
  );

  await call.reload();
  const earning = await Earning.findOne({ where: { callId: call.id } });
  assert.equal(await Earning.count({ where: { callId: call.id } }), 1);
  assert.ok(earning.coins >= settled);
  assert.equal(call.collectedCoins, voiceRate * 2);
  assert.ok(earning.coins <= call.collectedCoins, "never above collected coins");
  assert.ok(Number(call.coinsSpent) <= voiceRate * 2, "recorded cost covers the 65 s call");
});

test("charges after the late window are refused", async () => {
  await upsertTestWallet(MALE, 10_000);
  const call = await createCall({ acceptedSecondsAgo: 600 });
  await completeCallRecord({ callerId: MALE, receiverId: CREATOR, type: "voice", callHistoryId: call.id });
  await CallHistory.update(
    { endedAt: new Date(Date.now() - 10 * 60_000) },
    { where: { id: call.id } }
  );

  const voiceRate = await getCallRatePerMinute({ type: "voice", receiverId: CREATOR });
  const res = await spend({ amount: voiceRate, callId: call.id });
  assert.equal(res.statusCode, 409);
});

// ---------------------------------------------------------------------------
// Quick Connect attempt numbering (root cause of the intermittent test)
// ---------------------------------------------------------------------------

test("next attempt number skips numbers used by failed attempts", async () => {
  const { sessionId } = await createRingingQuickConnectAttempt({ receiverId: CREATOR, maxAttempts: 3 });

  // A failed ring keeps its row but does not advance session.attemptCount (1).
  await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt, failureReason)
     VALUES (:sessionId, :receiverId, 2, 'failed', NOW(3), NOW(3), 'routing_error')`,
    { replacements: { sessionId, receiverId: OTHER_CREATOR } }
  );

  assert.equal(await getNextAttemptNumber(sessionId, 1), 3);
  assert.equal(await getNextAttemptNumber(sessionId, 5), 6);
  assert.equal(await getNextAttemptNumber(999_999_999, 0), 1);
});
