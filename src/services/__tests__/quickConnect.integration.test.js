import test from "node:test";
import assert from "node:assert/strict";

import { sequelize } from "../../config/database.js";
import {
  ATTEMPT_STATUS,
  CALL_MODES,
  DEFAULT_QUICK_CONNECT,
  MAX_SELECTION_RETRIES,
  QC_TABLES,
  SESSION_STATUS,
} from "../../constants/quickConnect.js";
import {
  buildQuickConnectAcceptAck,
  transitionAttemptStatus,
  tryAcceptQuickConnectAttempt,
  processExpiredQuickConnectAttempts,
  __testables,
} from "../quickConnect.service.js";
import {
  callConnectedSql,
  callCountableSql,
} from "../adminGrowthMetrics.service.js";
import { ensureQuickConnectSchema } from "../quickConnectSchema.service.js";
import {
  releaseCreatorReservation,
  reserveCreatorAtomically,
} from "../creatorReservation.service.js";

const getInsertId = (queryResult) => {
  const [first, second] = queryResult;

  if (second && typeof second === "object" && second.insertId != null) {
    return Number(second.insertId);
  }

  return Number(first);
};

test.after(async () => {
  await sequelize.close();
});

test("buildQuickConnectAcceptAck maps rejection reasons for clients", () => {
  const ack = buildQuickConnectAcceptAck({
    accepted: false,
    reason: "timeout_or_not_ringing",
    sessionId: 10,
    attemptId: 20,
  });

  assert.equal(ack.accepted, false);
  assert.equal(ack.reason, "expired");
  assert.equal(ack.sessionId, "10");
  assert.equal(ack.attemptId, "20");
  assert.equal(ack.mode, CALL_MODES.QUICK_CONNECT);
});

test("MAX_SELECTION_RETRIES prevents unbounded selection loops", () => {
  assert.ok(MAX_SELECTION_RETRIES >= 3);
  assert.ok(MAX_SELECTION_RETRIES <= 50);
  assert.equal(
    MAX_SELECTION_RETRIES,
    DEFAULT_QUICK_CONNECT.maxSelectionRetries
  );
});

test("mapAcceptFailureReason normalizes server reasons", () => {
  assert.equal(__testables.mapAcceptFailureReason("session_not_routing"), "session_ended");
  assert.equal(__testables.mapAcceptFailureReason("forbidden"), "unavailable");
});

test("call analytics SQL excludes transient ringing and accepted-without-duration", () => {
  assert.match(callConnectedSql("ch"), /duration, 0\) > 0/);
  assert.doesNotMatch(callConnectedSql("ch"), /'accepted'/);
  assert.match(callCountableSql("ch"), /NOT IN \('ringing'\)/);
});

test("transitionAttemptStatus is idempotent for concurrent timeout workers", async () => {
  await ensureQuickConnectSchema({ force: true });

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (999001, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`
  );

  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, 999002, 1, 'ringing', NOW(3), DATE_ADD(NOW(3), INTERVAL 10 SECOND))`,
    { replacements: { sessionId } }
  );

  const attemptId = getInsertId(attemptResult);

  const [first, second] = await Promise.all([
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

  assert.equal(Number(first) + Number(second), 1);

  await sequelize.query(`DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`, {
    replacements: { attemptId },
  });
  await sequelize.query(`DELETE FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId`, {
    replacements: { sessionId },
  });
});

test("tryAcceptQuickConnectAttempt rejects expired ringing attempts", async () => {
  await ensureQuickConnectSchema({ force: true });

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (999011, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`
  );

  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, 999012, 1, 'ringing', DATE_SUB(NOW(3), INTERVAL 20 SECOND), DATE_SUB(NOW(3), INTERVAL 1 SECOND))`,
    { replacements: { sessionId } }
  );

  const attemptId = getInsertId(attemptResult);

  const result = await tryAcceptQuickConnectAttempt({
    attemptId,
    callerId: 999011,
    receiverId: 999012,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "expired");

  await sequelize.query(`DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`, {
    replacements: { attemptId },
  });
  await sequelize.query(`DELETE FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId`, {
    replacements: { sessionId },
  });
});

test("reservation cleanup releases creator after routing failure", async () => {
  await ensureQuickConnectSchema({ force: true });

  const creatorId = 999021;
  const sessionId = 999022;
  const attemptId = 999023;
  const expiresAt = new Date(Date.now() + 10_000);

  await releaseCreatorReservation({ creatorId });

  const reserved = await reserveCreatorAtomically({
    creatorId,
    sessionId,
    attemptId,
    expiresAt,
  });

  assert.equal(reserved.reserved, true);

  await __testables.cleanupRingAttemptOnError({
    attemptId,
    callHistoryId: null,
    creatorId,
    sessionId,
    failureReason: "routing_error",
  });

  const rows = await sequelize.query(
    `SELECT creatorId FROM creator_call_reservations WHERE creatorId = :creatorId`,
    { replacements: { creatorId } }
  );

  assert.equal(rows[0].length, 0);
});

test("processExpiredQuickConnectAttempts recovers expired ringing rows", async () => {
  await ensureQuickConnectSchema({ force: true });

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (999031, 'voice', 'quick_connect', 'routing', 3, 1, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND))`
  );

  const sessionId = getInsertId(sessionResult);

  const attemptResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.ATTEMPTS}
     (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt)
     VALUES (:sessionId, 999032, 1, 'ringing', DATE_SUB(NOW(3), INTERVAL 20 SECOND), DATE_SUB(NOW(3), INTERVAL 1 SECOND))`,
    { replacements: { sessionId } }
  );

  const attemptId = getInsertId(attemptResult);

  await reserveCreatorAtomically({
    creatorId: 999032,
    sessionId,
    attemptId,
    expiresAt: new Date(Date.now() - 1000),
  });

  await processExpiredQuickConnectAttempts();

  const [attemptRows] = await sequelize.query(
    `SELECT status FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`,
    { replacements: { attemptId } }
  );

  assert.equal(attemptRows[0].status, ATTEMPT_STATUS.MISSED);

  await sequelize.query(`DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`, {
    replacements: { attemptId },
  });
  await sequelize.query(`DELETE FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId`, {
    replacements: { sessionId },
  });
  await releaseCreatorReservation({ creatorId: 999032 });
});

test("session routing constants remain isolated from direct mode", () => {
  assert.notEqual(CALL_MODES.QUICK_CONNECT, CALL_MODES.DIRECT);
  assert.equal(SESSION_STATUS.ROUTING, "routing");
});
