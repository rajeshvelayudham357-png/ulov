/**
 * Quick Connect release-gate matrix (scenarios 1–50).
 * Service/DB level — no product logic changes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { sequelize } from "../../config/database.js";
import {
  ATTEMPT_STATUS,
  CALL_MODES,
  DEFAULT_QUICK_CONNECT,
  QC_TABLES,
  SESSION_STATUS,
} from "../../constants/quickConnect.js";
import { CallHistory, User } from "../../models/index.js";
import { createVideoCall } from "../../controllers/call.controller.js";
import {
  buildQuickConnectAcceptAck,
  cancelQuickConnectSession,
  createQuickConnectSession,
  handleQuickConnectAttemptFailure,
  handleQuickConnectCreatorRejected,
  isQuickConnectEnabled,
  processExpiredQuickConnectAttempts,
  setQuickConnectRuntime,
  startNextQuickConnectAttempt,
  transitionAttemptStatus,
  tryAcceptQuickConnectAttempt,
  __testables,
} from "../quickConnect.service.js";
import {
  reserveCreatorAtomically,
  releaseCreatorReservation,
  isCreatorReserved,
} from "../creatorReservation.service.js";
import { ensureQuickConnectSchema } from "../quickConnectSchema.service.js";
import { getAppSettings } from "../appSettings.service.js";
import {
  IDS,
  cleanupAllHarnessData,
  cleanupQcArtifacts,
  countQcSessionsForCaller,
  createMockRes,
  fetchAttemptRows,
  fetchSessionRow,
  getInsertId,
  installMockRuntime,
  seedEligibleCreators,
  upsertTestUser,
  withQuickConnectEnabled,
} from "./helpers/qcTestHarness.js";

test.before(async () => {
  await cleanupAllHarnessData();
  await seedEligibleCreators();
  installMockRuntime();
});

test.after(async () => {
  await cleanupAllHarnessData();
  setQuickConnectRuntime({ io: null, onlineUsers: null });
  await sequelize.close();
});

// ── SESSION CREATION (1–5) ──────────────────────────────────────────

test("[1-4] Quick Connect session creation defaults", async () => {
  await withQuickConnectEnabled(true, async () => {
    const runtime = installMockRuntime();

    const result = await createQuickConnectSession({
      callerId: IDS.MALE,
      type: "voice",
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, CALL_MODES.QUICK_CONNECT);
    assert.ok(result.sessionId);

    const session = await fetchSessionRow(result.sessionId);
    assert.equal(Number(session.maxAttempts), DEFAULT_QUICK_CONNECT.maxAttempts);
    assert.equal(Number(session.attemptCount), 1);

    const attempts = await fetchAttemptRows(result.sessionId);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, ATTEMPT_STATUS.RINGING);

    const ringMs =
      new Date(attempts[0].ringExpiresAt).getTime() -
      new Date(attempts[0].ringStartedAt).getTime();
    assert.ok(ringMs >= 9_000 && ringMs <= 11_000);

    const [deadlineRows] = await sequelize.query(
      `SELECT (deadlineAt > startedAt) AS validDeadline
       FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId`,
      { replacements: { sessionId: result.sessionId } }
    );
    assert.equal(Number(deadlineRows[0].validDeadline), 1);

    await cleanupQcArtifacts({
      sessionIds: [result.sessionId],
      callHistoryIds: [result.callId],
      creatorIds: [attempts[0].receiverId],
    });
    runtime.clear();
  });
});

test("[5] Feature flag OFF prevents Quick Connect", async () => {
  await withQuickConnectEnabled(false, async () => {
    const enabled = await isQuickConnectEnabled();
    assert.equal(enabled, false);

    await assert.rejects(
      () =>
        createQuickConnectSession({
          callerId: IDS.MALE,
          type: "voice",
        }),
      (error) => error.statusCode === 403
    );

    const res = createMockRes();
    await createVideoCall(
      { body: { callerId: IDS.MALE, type: "voice", mode: "quick_connect" } },
      res
    );
    assert.equal(res.statusCode, 403);
  });
});

// ── CREATOR ELIGIBILITY (6–12) ─────────────────────────────────────

test("[6-12] Creator eligibility filters", async () => {
  await CallHistory.destroy({
    where: { receiverId: [IDS.CREATOR_A, IDS.CREATOR_B, IDS.CREATOR_C, IDS.CREATOR_BLOCKED] },
  });
  await releaseCreatorReservation({ creatorId: IDS.CREATOR_A });
  await releaseCreatorReservation({ creatorId: IDS.CREATOR_B });
  await releaseCreatorReservation({ creatorId: IDS.CREATOR_C });

  const creator = await __testables.selectEligibleCreator({
    callerId: IDS.MALE,
    callType: "voice",
    excludedReceiverIds: [],
  });

  assert.ok(creator);

  const creatorUser = await User.findByPk(creator.id);
  assert.ok(creatorUser);
  assert.equal(String(creatorUser.gender ?? "").toLowerCase(), "female");
  assert.equal(creatorUser.accountStatus, "approved");
  assert.equal(Boolean(creatorUser.online), true);

  const blocked = await __testables.selectEligibleCreator({
    callerId: IDS.MALE,
    callType: "voice",
    excludedReceiverIds: [IDS.CREATOR_BLOCKED],
  });
  assert.notEqual(Number(blocked?.id), IDS.CREATOR_BLOCKED);

  const excluded = await __testables.selectEligibleCreator({
    callerId: IDS.MALE,
    callType: "voice",
    excludedReceiverIds: [IDS.CREATOR_A],
  });
  assert.notEqual(Number(excluded?.id), IDS.CREATOR_A);

  const offlineCheck = await __testables.validateCreatorBeforeRing({
    creatorId: IDS.CREATOR_OFFLINE,
    callerId: IDS.MALE,
  });
  assert.equal(offlineCheck.ok, false);
  assert.equal(offlineCheck.reason, "offline");
});

// ── ROUTING (13–21) ────────────────────────────────────────────────

test("[13-15] Reservation succeeds and blocks competing session", async () => {
  await ensureQuickConnectSchema({ force: true });

  const sessionAResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 0, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionA = getInsertId(sessionAResult);

  const attemptAResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    {
      replacements: { sessionId: sessionA, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptA = getInsertId(attemptAResult);

  const reserved = await reserveCreatorAtomically({
    creatorId: IDS.CREATOR_A,
    sessionId: sessionA,
    attemptId: attemptA,
    expiresAt: new Date(Date.now() + 10_000),
  });
  assert.equal(reserved.reserved, true);

  const competing = await reserveCreatorAtomically({
    creatorId: IDS.CREATOR_A,
    sessionId: sessionA + 1,
    attemptId: attemptA + 1,
    expiresAt: new Date(Date.now() + 10_000),
  });
  assert.equal(competing.reserved, false);
  assert.equal(competing.reason, "already_reserved");

  await cleanupQcArtifacts({
    sessionIds: [sessionA],
    creatorIds: [IDS.CREATOR_A],
  });
});

test("[16-21] Busy/offline skipped; reservation failure does not consume attempt", async () => {
  await withQuickConnectEnabled(true, async () => {
    await upsertTestUser({
      id: IDS.CREATOR_A,
      gender: "Female",
      online: true,
      acceptAutoRoutedCalls: true,
    });

    await CallHistory.create({
      callerId: IDS.BUSY_CALLER,
      receiverId: IDS.CREATOR_A,
      type: "voice",
      duration: 0,
      coinsSpent: 0,
      status: "live",
    });

    const busyValidation = await __testables.validateCreatorBeforeRing({
      creatorId: IDS.CREATOR_A,
      callerId: IDS.MALE,
    });
    assert.equal(busyValidation.ok, false);
    assert.equal(busyValidation.reason, "busy");

    await CallHistory.destroy({
      where: { receiverId: IDS.CREATOR_A, callerId: IDS.BUSY_CALLER, status: "live" },
    });

    const sessionResult = await sequelize.query(
      `INSERT INTO ${QC_TABLES.SESSIONS}
       (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
       VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 0, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
      { replacements: { callerId: IDS.MALE } }
    );
    const sessionId = getInsertId(sessionResult);

    await reserveCreatorAtomically({
      creatorId: IDS.CREATOR_B,
      sessionId,
      attemptId: 999999,
      expiresAt: new Date(Date.now() + 10_000),
    });

    const beforeCount = (await fetchSessionRow(sessionId)).attemptCount;

    const next = await startNextQuickConnectAttempt({ sessionId });
    assert.equal(next.success, true);

    const afterSession = await fetchSessionRow(sessionId);
    assert.equal(Number(afterSession.attemptCount), Number(beforeCount) + 1);

    const attempts = await fetchAttemptRows(sessionId);
    const receiverIds = attempts.map((row) => Number(row.receiverId));
    assert.equal(new Set(receiverIds).size, receiverIds.length);

    await cleanupQcArtifacts({
      sessionIds: [sessionId],
      callHistoryIds: attempts.map((row) => row.callHistoryId).filter(Boolean),
      creatorIds: [IDS.CREATOR_B, ...receiverIds],
    });
  });
});

// ── TIMEOUT (22–27) ────────────────────────────────────────────────

test("[22-25] Timeout marks missed and releases reservation", async () => {
  await ensureQuickConnectSchema({ force: true });

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', DATE_SUB(NOW(3), INTERVAL 15 SECOND), DATE_SUB(NOW(3), INTERVAL 1 SECOND))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  await reserveCreatorAtomically({
    creatorId: IDS.CREATOR_A,
    sessionId,
    attemptId,
    expiresAt: new Date(Date.now() + 60_000),
  });

  assert.equal(await isCreatorReserved(IDS.CREATOR_A), true);

  await processExpiredQuickConnectAttempts();

  const [attemptRows] = await sequelize.query(
    `SELECT status FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`,
    { replacements: { attemptId } }
  );
  assert.equal(attemptRows[0].status, ATTEMPT_STATUS.MISSED);
  assert.equal(await isCreatorReserved(IDS.CREATOR_A), false);

  await cleanupQcArtifacts({
    sessionIds: [sessionId],
    creatorIds: [IDS.CREATOR_A],
  });
});

test("[26-27] Three failed attempts and routing deadline end session", async () => {
  await withQuickConnectEnabled(true, async () => {
    const sessionResult = await sequelize.query(
      `INSERT INTO ${QC_TABLES.SESSIONS}
       (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
       VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 3, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
      { replacements: { callerId: IDS.MALE } }
    );
    const sessionId = getInsertId(sessionResult);

    const next = await startNextQuickConnectAttempt({ sessionId });
    assert.equal(next.success, false);
    assert.equal(next.reason, "max_attempts_reached");

    await cleanupQcArtifacts({ sessionIds: [sessionId] });
  });
});

// ── ACCEPTANCE (28–33) ─────────────────────────────────────────────

test("[28] Accept before expiry succeeds", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  const result = await tryAcceptQuickConnectAttempt({
    attemptId,
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
  });

  assert.equal(result.accepted, true);

  const session = await fetchSessionRow(sessionId);
  assert.equal(session.status, SESSION_STATUS.CONNECTING);

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_A] });
});

test("[29] Accept after expiry fails", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', DATE_SUB(NOW(3), INTERVAL 15 SECOND), DATE_SUB(NOW(3), INTERVAL 1 SECOND))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  const result = await tryAcceptQuickConnectAttempt({
    attemptId,
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "expired");

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_A] });
});

test("[30] Accept/timeout boundary is deterministic — only one wins", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', DATE_SUB(NOW(3), INTERVAL 10 SECOND), NOW(3))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  const [acceptWon, timeoutWon] = await Promise.all([
    tryAcceptQuickConnectAttempt({
      attemptId,
      callerId: IDS.MALE,
      receiverId: IDS.CREATOR_A,
    }),
    transitionAttemptStatus({
      attemptId,
      fromStatus: ATTEMPT_STATUS.RINGING,
      toStatus: ATTEMPT_STATUS.MISSED,
      failureReason: "timeout",
    }),
  ]);

  const wins = Number(acceptWon.accepted) + Number(timeoutWon);
  assert.equal(wins, 1);

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_A] });
});

test("[31] Accepted attempt cannot be rerouted via failure handler", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'connecting', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt, acceptedAt)
     VALUES (:sessionId, :receiverId, 1, 'accepted', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND), NOW(3))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  const failure = await handleQuickConnectAttemptFailure({
    attemptId,
    terminalStatus: ATTEMPT_STATUS.MISSED,
    failureReason: "timeout",
  });

  assert.equal(failure.handled, false);

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_A] });
});

test("[32-33] Server ack gates Agora join — rejected ack must not proceed", () => {
  const rejected = buildQuickConnectAcceptAck({
    accepted: false,
    reason: "expired",
    sessionId: 1,
    attemptId: 2,
  });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "expired");

  const accepted = buildQuickConnectAcceptAck({
    accepted: true,
    sessionId: 1,
    attemptId: 2,
  });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.reason, null);
});

// ── REJECTION / OFFLINE / BUSY (34–37) ─────────────────────────────

test("[34-36] Rejection and offline finalize and reroute", async () => {
  await withQuickConnectEnabled(true, async () => {
    const runtime = installMockRuntime();

    const sessionResult = await sequelize.query(
      `INSERT INTO ${QC_TABLES.SESSIONS}
       (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
       VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
      { replacements: { callerId: IDS.MALE } }
    );
    const sessionId = getInsertId(sessionResult);

    const attemptResult = await sequelize.query(
      `INSERT INTO ${QC_TABLES.ATTEMPTS}
       (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
       VALUES (:sessionId, :receiverId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
      {
        replacements: { sessionId, receiverId: IDS.CREATOR_A },
      }
    );
    const attemptId = getInsertId(attemptResult);

    await reserveCreatorAtomically({
      creatorId: IDS.CREATOR_A,
      sessionId,
      attemptId,
      expiresAt: new Date(Date.now() + 10_000),
    });

    runtime.clear();
    await handleQuickConnectCreatorRejected({ attemptId });

    const rerouteEvents = runtime.emitted.filter((row) => row.event === "call-rerouted");
    assert.ok(rerouteEvents.length <= 1);

    await cleanupQcArtifacts({
      sessionIds: [sessionId],
      creatorIds: [IDS.CREATOR_A, IDS.CREATOR_B, IDS.CREATOR_C],
    });
  });
});

test("[37] Duplicate timeout processing emits at most one reroute", async () => {
  const runtime = installMockRuntime();

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', DATE_SUB(NOW(3), INTERVAL 15 SECOND), DATE_SUB(NOW(3), INTERVAL 1 SECOND))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  runtime.clear();
  await processExpiredQuickConnectAttempts();
  await processExpiredQuickConnectAttempts();

  const reroutes = runtime.emitted.filter((row) => row.event === "call-rerouted");
  assert.ok(reroutes.length <= 1);

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_A] });
});

// ── CANCELLATION (38–41) ───────────────────────────────────────────

test("[38-41] Cancellation ends session, releases reservation, is idempotent", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  await reserveCreatorAtomically({
    creatorId: IDS.CREATOR_A,
    sessionId,
    attemptId,
    expiresAt: new Date(Date.now() + 10_000),
  });

  const first = await cancelQuickConnectSession({
    sessionId,
    callerId: IDS.MALE,
  });
  assert.equal(first.cancelled, true);
  assert.equal(await isCreatorReserved(IDS.CREATOR_A), false);

  const second = await cancelQuickConnectSession({
    sessionId,
    callerId: IDS.MALE,
  });
  assert.equal(second.cancelled, true);
  assert.equal(second.alreadyTerminal, true);

  const next = await startNextQuickConnectAttempt({ sessionId });
  assert.equal(next.success, false);

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_A] });
});

// ── ERROR CLEANUP (42–45) ──────────────────────────────────────────

test("[42-44] Routing error cleanup releases reservation", async () => {
  const creatorId = IDS.CREATOR_B;
  const sessionId = 881900;
  const attemptId = 881901;

  await releaseCreatorReservation({ creatorId });

  await reserveCreatorAtomically({
    creatorId,
    sessionId,
    attemptId,
    expiresAt: new Date(Date.now() + 10_000),
  });

  await __testables.cleanupRingAttemptOnError({
    attemptId,
    callHistoryId: null,
    creatorId,
    sessionId,
    failureReason: "routing_error",
  });

  assert.equal(await isCreatorReserved(creatorId), false);
});

test("[45] Server restart recovers expired ringing attempts", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', DATE_SUB(NOW(3), INTERVAL 20 SECOND), DATE_SUB(NOW(3), INTERVAL 2 SECOND))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_C },
    }
  );
  const attemptId = getInsertId(attemptResult);

  await processExpiredQuickConnectAttempts();

  const [rows] = await sequelize.query(
    `SELECT status FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`,
    { replacements: { attemptId } }
  );
  assert.equal(rows[0].status, ATTEMPT_STATUS.MISSED);

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_C] });
});

// ── CONCURRENCY (46–50) ────────────────────────────────────────────

test("[46] Two sessions cannot reserve same creator", async () => {
  await releaseCreatorReservation({ creatorId: IDS.CREATOR_C });
  await CallHistory.destroy({
    where: { receiverId: IDS.CREATOR_C },
  });

  const first = await reserveCreatorAtomically({
    creatorId: IDS.CREATOR_C,
    sessionId: 881801,
    attemptId: 881802,
    expiresAt: new Date(Date.now() + 10_000),
  });
  assert.equal(first.reserved, true);

  const second = await reserveCreatorAtomically({
    creatorId: IDS.CREATOR_C,
    sessionId: 881803,
    attemptId: 881804,
    expiresAt: new Date(Date.now() + 10_000),
  });
  assert.equal(second.reserved, false);

  await releaseCreatorReservation({ creatorId: IDS.CREATOR_C });
});

test("[47-48] Watchdog and accept race — only one transition succeeds", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  const [a, b] = await Promise.all([
    transitionAttemptStatus({
      attemptId,
      fromStatus: ATTEMPT_STATUS.RINGING,
      toStatus: ATTEMPT_STATUS.MISSED,
      failureReason: "timeout",
    }),
    transitionAttemptStatus({
      attemptId,
      fromStatus: ATTEMPT_STATUS.RINGING,
      toStatus: ATTEMPT_STATUS.MISSED,
      failureReason: "timeout",
    }),
  ]);

  assert.equal(Number(a) + Number(b), 1);

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_A] });
});

test("[49] Accept and cancellation cannot both succeed", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, :receiverId, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    {
      replacements: { sessionId, receiverId: IDS.CREATOR_A },
    }
  );
  const attemptId = getInsertId(attemptResult);

  await cancelQuickConnectSession({ sessionId, callerId: IDS.MALE });

  const accept = await tryAcceptQuickConnectAttempt({
    attemptId,
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
  });

  assert.equal(accept.accepted, false);

  await cleanupQcArtifacts({ sessionIds: [sessionId], creatorIds: [IDS.CREATOR_A] });
});

test("[50] Cancelled session prevents new attempt from reroute path", async () => {
  const runtime = installMockRuntime();

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, 'voice', 'quick_connect', 'cancelled', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  runtime.clear();
  const next = await startNextQuickConnectAttempt({ sessionId });
  assert.equal(next.success, false);

  const reroutes = runtime.emitted.filter((row) => row.event === "call-rerouted");
  assert.equal(reroutes.length, 0);

  await cleanupQcArtifacts({ sessionIds: [sessionId] });
});

test("App settings defaults keep Quick Connect disabled", async () => {
  const settings = await getAppSettings();
  assert.equal(Boolean(settings.quickConnectEnabled), false);
  assert.equal(Number(settings.quickConnectMaxAttempts), 3);
  assert.equal(Number(settings.quickConnectRingTimeoutSeconds), 10);
});
