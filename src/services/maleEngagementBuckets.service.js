import { toIstDateKey } from "./adminRevenueTime.service.js";

/** Non-overlapping engagement states (IST calendar-day days-since meaningful activity). */
export const ENGAGEMENT_BUCKETS = {
  ACTIVE_TODAY: "ACTIVE_TODAY",
  ACTIVE_1_7_DAYS: "ACTIVE_1_7_DAYS",
  AT_RISK_8_14_DAYS: "AT_RISK_8_14_DAYS",
  DORMANT_15_30_DAYS: "DORMANT_15_30_DAYS",
  DORMANT_31_60_DAYS: "DORMANT_31_60_DAYS",
  DORMANT_60_PLUS_DAYS: "DORMANT_60_PLUS_DAYS",
  NEVER_ACTIVE: "NEVER_ACTIVE",
};

export const ENGAGEMENT_BUCKET_DEFINITIONS = {
  timezone: "Asia/Kolkata (IST)",
  /**
   * Days since last_meaningful_activity_at, using IST calendar dates:
   * DATEDIFF(todayIstDate, DATE(last_meaningful_activity_at + 330 minutes))
   */
  daysSinceBasis: "last_meaningful_activity_at",
  buckets: {
    [ENGAGEMENT_BUCKETS.NEVER_ACTIVE]:
      "No canonical meaningful activity recorded (last_meaningful_activity_at IS NULL).",
    [ENGAGEMENT_BUCKETS.ACTIVE_TODAY]: "daysSince = 0",
    [ENGAGEMENT_BUCKETS.ACTIVE_1_7_DAYS]: "daysSince BETWEEN 1 AND 7",
    [ENGAGEMENT_BUCKETS.AT_RISK_8_14_DAYS]: "daysSince BETWEEN 8 AND 14",
    [ENGAGEMENT_BUCKETS.DORMANT_15_30_DAYS]: "daysSince BETWEEN 15 AND 30",
    [ENGAGEMENT_BUCKETS.DORMANT_31_60_DAYS]: "daysSince BETWEEN 31 AND 60",
    [ENGAGEMENT_BUCKETS.DORMANT_60_PLUS_DAYS]: "daysSince >= 61",
  },
};

/** SQL expression: IST calendar date of last meaningful activity (nullable). */
export const MEANINGFUL_ACTIVITY_IST_DATE_SQL =
  "DATE(DATE_ADD(ues.last_meaningful_activity_at, INTERVAL 330 MINUTE))";

/**
 * SQL expression: IST calendar days since last meaningful activity (NULL when never active).
 * :todayIstDate must be YYYY-MM-DD (IST "today").
 */
export const DAYS_SINCE_MEANINGFUL_SQL = `CASE
  WHEN ues.last_meaningful_activity_at IS NULL THEN NULL
  ELSE DATEDIFF(:todayIstDate, ${MEANINGFUL_ACTIVITY_IST_DATE_SQL})
END`;

/** SQL CASE for engagement bucket (matches resolveEngagementBucket). */
export const ENGAGEMENT_BUCKET_SQL = `CASE
  WHEN ues.last_meaningful_activity_at IS NULL THEN '${ENGAGEMENT_BUCKETS.NEVER_ACTIVE}'
  WHEN ${DAYS_SINCE_MEANINGFUL_SQL} = 0 THEN '${ENGAGEMENT_BUCKETS.ACTIVE_TODAY}'
  WHEN ${DAYS_SINCE_MEANINGFUL_SQL} BETWEEN 1 AND 7 THEN '${ENGAGEMENT_BUCKETS.ACTIVE_1_7_DAYS}'
  WHEN ${DAYS_SINCE_MEANINGFUL_SQL} BETWEEN 8 AND 14 THEN '${ENGAGEMENT_BUCKETS.AT_RISK_8_14_DAYS}'
  WHEN ${DAYS_SINCE_MEANINGFUL_SQL} BETWEEN 15 AND 30 THEN '${ENGAGEMENT_BUCKETS.DORMANT_15_30_DAYS}'
  WHEN ${DAYS_SINCE_MEANINGFUL_SQL} BETWEEN 31 AND 60 THEN '${ENGAGEMENT_BUCKETS.DORMANT_31_60_DAYS}'
  ELSE '${ENGAGEMENT_BUCKETS.DORMANT_60_PLUS_DAYS}'
END`;

export const getMeaningfulActivityIstDateKey = (lastMeaningfulActivityAt) => {
  if (!lastMeaningfulActivityAt) {
    return null;
  }

  const date = new Date(lastMeaningfulActivityAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return toIstDateKey(date);
};

/**
 * @param {number|null} daysSince IST calendar days since meaningful activity
 * @param {boolean} hasMeaningfulActivity
 */
export const resolveEngagementBucket = (daysSince, hasMeaningfulActivity) => {
  if (!hasMeaningfulActivity || daysSince == null) {
    return ENGAGEMENT_BUCKETS.NEVER_ACTIVE;
  }

  if (daysSince === 0) {
    return ENGAGEMENT_BUCKETS.ACTIVE_TODAY;
  }
  if (daysSince >= 1 && daysSince <= 7) {
    return ENGAGEMENT_BUCKETS.ACTIVE_1_7_DAYS;
  }
  if (daysSince >= 8 && daysSince <= 14) {
    return ENGAGEMENT_BUCKETS.AT_RISK_8_14_DAYS;
  }
  if (daysSince >= 15 && daysSince <= 30) {
    return ENGAGEMENT_BUCKETS.DORMANT_15_30_DAYS;
  }
  if (daysSince >= 31 && daysSince <= 60) {
    return ENGAGEMENT_BUCKETS.DORMANT_31_60_DAYS;
  }

  return ENGAGEMENT_BUCKETS.DORMANT_60_PLUS_DAYS;
};

export const getIstDaysSinceMeaningfulActivity = (
  lastMeaningfulActivityAt,
  todayIstDateKey = toIstDateKey(new Date())
) => {
  const activityKey = getMeaningfulActivityIstDateKey(lastMeaningfulActivityAt);
  if (!activityKey) {
    return null;
  }

  const start = new Date(`${activityKey}T00:00:00+05:30`).getTime();
  const end = new Date(`${todayIstDateKey}T00:00:00+05:30`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
};
