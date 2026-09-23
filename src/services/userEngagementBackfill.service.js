import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { mergeEngagementTimestampOnDuplicateSql } from "./userEngagementBackfillMerge.js";
import { ensureUserEngagementStatsSchema } from "./userEngagementSchema.service.js";

const DUPLICATE_UPDATES = [
  "last_auth_login_at",
  "last_creator_profile_viewed_at",
  "last_chat_at",
  "last_call_at",
  "last_recharge_at",
  "last_meaningful_activity_at",
  "last_app_open_at",
  "last_session_started_at",
]
  .map((column) => mergeEngagementTimestampOnDuplicateSql(column))
  .join(",\n       ");

/**
 * Idempotent backfill for male users from allowlisted historical sources only.
 * Safe to run multiple times (monotonic merge; NULL incoming never poisons rows).
 * Does NOT use users.updatedAt or device_tokens.updatedAt.
 * Does NOT backfill APP_OPEN / SESSION_STARTED.
 */
export const backfillMaleUserEngagementStats = async () => {
  await ensureUserEngagementStatsSchema();

  const [result] = await sequelize.query(
    `INSERT INTO user_engagement_stats (
       userId,
       last_auth_login_at,
       last_creator_profile_viewed_at,
       last_chat_at,
       last_call_at,
       last_recharge_at,
       last_meaningful_activity_at,
       createdAt,
       updatedAt
     )
     SELECT
       u.id AS userId,
       u.lastLoginAt AS last_auth_login_at,
       gev.last_creator_profile_viewed_at,
       CASE
         WHEN gev.last_chat_at IS NULL AND cm.last_chat_at IS NULL THEN NULL
         WHEN gev.last_chat_at IS NULL THEN cm.last_chat_at
         WHEN cm.last_chat_at IS NULL THEN gev.last_chat_at
         ELSE GREATEST(gev.last_chat_at, cm.last_chat_at)
       END AS last_chat_at,
       CASE
         WHEN ch.last_call_attempt_at IS NULL AND ch.last_call_completed_at IS NULL THEN NULL
         WHEN ch.last_call_attempt_at IS NULL THEN ch.last_call_completed_at
         WHEN ch.last_call_completed_at IS NULL THEN ch.last_call_attempt_at
         ELSE GREATEST(ch.last_call_attempt_at, ch.last_call_completed_at)
       END AS last_call_at,
       po.last_recharge_at,
       (
         SELECT MAX(v)
         FROM (
           SELECT u.lastLoginAt AS v
           UNION ALL SELECT gev.last_creator_profile_viewed_at
           UNION ALL SELECT gev.last_chat_at
           UNION ALL SELECT cm.last_chat_at
           UNION ALL SELECT ch.last_call_attempt_at
           UNION ALL SELECT ch.last_call_completed_at
           UNION ALL SELECT po.last_recharge_at
         ) AS meaningful_src(v)
         WHERE v IS NOT NULL
       ) AS last_meaningful_activity_at,
       NOW(),
       NOW()
     FROM users u
     LEFT JOIN (
       SELECT
         ge.userId,
         MAX(CASE WHEN ge.eventName = 'CREATOR_PROFILE_VIEWED' THEN ge.createdAt END) AS last_creator_profile_viewed_at,
         MAX(CASE WHEN ge.eventName = 'CHAT_STARTED' THEN ge.createdAt END) AS last_chat_at
       FROM growth_events ge
       GROUP BY ge.userId
     ) gev ON gev.userId = u.id
     LEFT JOIN (
       SELECT
         cm.senderId AS userId,
         MAX(cm.createdAt) AS last_chat_at
       FROM chat_messages cm
       GROUP BY cm.senderId
     ) cm ON cm.userId = u.id
     LEFT JOIN (
       SELECT
         ch.callerId AS userId,
         MAX(ch.createdAt) AS last_call_attempt_at,
         MAX(CASE WHEN ch.status = 'completed' THEN COALESCE(ch.updatedAt, ch.createdAt) END) AS last_call_completed_at
       FROM call_histories ch
       GROUP BY ch.callerId
     ) ch ON ch.userId = u.id
     LEFT JOIN (
       SELECT
         po.userId,
         MAX(COALESCE(po.updatedAt, po.createdAt)) AS last_recharge_at
       FROM payment_orders po
       WHERE po.status = 'PAID'
       GROUP BY po.userId
     ) po ON po.userId = u.id
     WHERE u.gender IN ('Male', 'male')
     ON DUPLICATE KEY UPDATE
       ${DUPLICATE_UPDATES},
       updatedAt = NOW()`,
    {
      type: QueryTypes.INSERT,
    }
  );

  const affected = Number(result?.affectedRows ?? result ?? 0);

  const [countRow] = await sequelize.query(
    `SELECT COUNT(*) AS total
     FROM user_engagement_stats ues
     INNER JOIN users u ON u.id = ues.userId
     WHERE u.gender IN ('Male', 'male')`,
    { type: QueryTypes.SELECT }
  );

  return {
    affectedRows: affected,
    maleStatsRows: Number(countRow?.total ?? 0),
  };
};
