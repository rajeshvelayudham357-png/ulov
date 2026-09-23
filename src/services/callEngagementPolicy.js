/**
 * CALL_ATTEMPTED is recorded only when a new call_histories row is created.
 * Re-upserts / updates to an existing live call must not record again.
 */
export const shouldRecordCallAttemptedEngagement = ({
  createdNewCallHistory = false,
} = {}) => Boolean(createdNewCallHistory);
