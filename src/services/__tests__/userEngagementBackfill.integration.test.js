import test from "node:test";
import assert from "node:assert/strict";

import { QueryTypes } from "sequelize";

import { sequelize } from "../../config/database.js";
import { backfillMaleUserEngagementStats } from "../userEngagementBackfill.service.js";
import {
  cleanUserEngagementBackfillEpochArtifacts,
  countEpochByColumn,
  snapshotEngagementCounts,
} from "../userEngagementEpochCleanup.service.js";
import { BACKFILL_EPOCH_ARTIFACT } from "../userEngagementBackfillMerge.js";

const hasDatabase = Boolean(
  process.env.DB_NAME && process.env.DB_HOST && process.env.DB_USER
);

test("backfill second run is stable and produces no epoch artifacts", {
  skip: !hasDatabase,
}, async () => {
  await cleanUserEngagementBackfillEpochArtifacts();

  const beforeFirst = await snapshotEngagementCounts();
  await backfillMaleUserEngagementStats();
  const afterFirst = await snapshotEngagementCounts();
  await backfillMaleUserEngagementStats();
  const afterSecond = await snapshotEngagementCounts();

  assert.deepEqual(afterFirst, afterSecond);
  assert.equal(afterFirst.total_rows, afterSecond.total_rows);

  const epochCounts = await countEpochByColumn();
  for (const total of Object.values(epochCounts)) {
    assert.equal(total, 0);
  }

  const [olderThanSources] = await sequelize.query(
    `SELECT COUNT(*) AS cnt
     FROM user_engagement_stats ues
     JOIN users u ON u.id = ues.userId AND u.gender IN ('Male','male')
     WHERE ues.last_meaningful_activity_at IS NOT NULL
       AND (
         (u.lastLoginAt IS NOT NULL AND u.lastLoginAt > ues.last_meaningful_activity_at)
         OR EXISTS (
           SELECT 1 FROM growth_events ge
           WHERE ge.userId = ues.userId
             AND ge.eventName IN ('CREATOR_PROFILE_VIEWED','CHAT_STARTED')
             AND ge.createdAt > ues.last_meaningful_activity_at
         )
         OR EXISTS (
           SELECT 1 FROM chat_messages cm
           WHERE cm.senderId = ues.userId AND cm.createdAt > ues.last_meaningful_activity_at
         )
         OR EXISTS (
           SELECT 1 FROM call_histories ch
           WHERE ch.callerId = ues.userId AND ch.createdAt > ues.last_meaningful_activity_at
         )
         OR EXISTS (
           SELECT 1 FROM call_histories ch
           WHERE ch.callerId = ues.userId AND ch.status = 'completed'
             AND COALESCE(ch.updatedAt, ch.createdAt) > ues.last_meaningful_activity_at
         )
         OR EXISTS (
           SELECT 1 FROM payment_orders po
           WHERE po.userId = ues.userId AND po.status = 'PAID'
             AND COALESCE(po.updatedAt, po.createdAt) > ues.last_meaningful_activity_at
         )
       )`,
    { type: QueryTypes.SELECT }
  );

  assert.equal(Number(olderThanSources?.cnt ?? 0), 0);

  assert.notEqual(beforeFirst.total_rows, 0);
  assert.equal(BACKFILL_EPOCH_ARTIFACT, "1970-01-01 00:00:00");
});
