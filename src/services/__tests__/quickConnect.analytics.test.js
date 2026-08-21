/**
 * Quick Connect analytics / CallHistory counting regression.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { sequelize } from "../../config/database.js";
import {
  callConnectedSql,
  callCountableSql,
} from "../adminGrowthMetrics.service.js";
import { CallHistory } from "../../models/index.js";
import {
  IDS,
  cleanupAllHarnessData,
  getInsertId,
  seedEligibleCreators,
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

test("1 session, 3 attempts, 1 connected call — analytics SQL distinguishes", async () => {
  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt, connectedCallHistoryId)
     VALUES (:callerId, 'voice', 'quick_connect', 'connected', 3, 3, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 SECOND), NULL)`,
    { replacements: { callerId: IDS.MALE } }
  );
  const sessionId = getInsertId(sessionResult);

  const missed = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "missed",
  });

  const rejected = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_B,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "rejected",
  });

  const connected = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_C,
    type: "voice",
    duration: 180,
    coinsSpent: 50,
    status: "completed",
  });

  await sequelize.query(
    `UPDATE ${QC_TABLES.SESSIONS}
     SET connectedCallHistoryId = :connectedId, attemptCount = 3
     WHERE id = :sessionId`,
    {
      replacements: { sessionId, connectedId: connected.id },
    }
  );

  const [countRows] = await sequelize.query(
    `SELECT
       COUNT(*) AS rawTotal,
       SUM(CASE WHEN ${callCountableSql("ch")} THEN 1 ELSE 0 END) AS countableTotal,
       SUM(CASE WHEN ${callConnectedSql("ch")} THEN 1 ELSE 0 END) AS connectedTotal
     FROM call_histories ch
     WHERE ch.id IN (:missedId, :rejectedId, :connectedId)`,
    {
      replacements: {
        missedId: missed.id,
        rejectedId: rejected.id,
        connectedId: connected.id,
      },
    }
  );

  assert.equal(Number(countRows[0].rawTotal), 3);
  assert.equal(Number(countRows[0].countableTotal), 3);
  assert.equal(Number(countRows[0].connectedTotal), 1);

  const acceptedRow = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "accepted",
  });

  const [acceptedZero] = await sequelize.query(
    `SELECT CASE WHEN ${callConnectedSql("ch")} THEN 1 ELSE 0 END AS isConnected
     FROM call_histories ch
     WHERE ch.id = :id`,
    { replacements: { id: acceptedRow.id } }
  );
  assert.equal(Number(acceptedZero[0].isConnected), 0);
  await CallHistory.destroy({ where: { id: acceptedRow.id } });

  const ringing = await CallHistory.create({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_B,
    type: "voice",
    duration: 0,
    coinsSpent: 0,
    status: "ringing",
  });

  const [ringingCount] = await sequelize.query(
    `SELECT CASE WHEN ${callCountableSql("ch")} THEN 1 ELSE 0 END AS countable
     FROM call_histories ch WHERE ch.id = :id`,
    { replacements: { id: ringing.id } }
  );
  assert.equal(Number(ringingCount[0].countable), 0);

  await CallHistory.destroy({
    where: { id: [missed.id, rejected.id, connected.id, ringing.id] },
  });
  await sequelize.query(`DELETE FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId`, {
    replacements: { sessionId },
  });
});
