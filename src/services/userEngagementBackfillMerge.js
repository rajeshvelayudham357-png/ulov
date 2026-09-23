/**
 * Pure merge semantics for backfill ON DUPLICATE KEY UPDATE (and tests).
 * NULL incoming preserves existing; NULL existing accepts incoming; else GREATEST.
 */
export const mergeEngagementTimestamp = (existing, incoming) => {
  if (incoming === null || incoming === undefined) {
    return existing === undefined ? null : existing;
  }
  if (existing === null || existing === undefined) {
    return incoming;
  }

  const existingTime =
    existing instanceof Date ? existing.getTime() : new Date(existing).getTime();
  const incomingTime =
    incoming instanceof Date ? incoming.getTime() : new Date(incoming).getTime();

  if (Number.isNaN(existingTime)) {
    return incoming;
  }
  if (Number.isNaN(incomingTime)) {
    return existing;
  }

  return existingTime >= incomingTime ? existing : incoming;
};

/** MySQL ON DUPLICATE KEY UPDATE fragment for one column (no sentinel). */
export const mergeEngagementTimestampOnDuplicateSql = (columnName) =>
  `${columnName} = CASE
    WHEN VALUES(${columnName}) IS NULL THEN user_engagement_stats.${columnName}
    WHEN user_engagement_stats.${columnName} IS NULL THEN VALUES(${columnName})
    ELSE GREATEST(user_engagement_stats.${columnName}, VALUES(${columnName}))
  END`;

export const BACKFILL_EPOCH_ARTIFACT = "1970-01-01 00:00:00";

export const ENGAGEMENT_TIMESTAMP_COLUMNS = [
  "last_meaningful_activity_at",
  "last_app_open_at",
  "last_session_started_at",
  "last_creator_profile_viewed_at",
  "last_chat_at",
  "last_call_at",
  "last_recharge_at",
  "last_auth_login_at",
];
