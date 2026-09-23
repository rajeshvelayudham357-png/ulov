import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { addIstDays, istDateKeyToUtcRange, toIstDateKey } from "./adminRevenueTime.service.js";
import {
  DAYS_SINCE_MEANINGFUL_SQL,
  ENGAGEMENT_BUCKET_DEFINITIONS,
  ENGAGEMENT_BUCKET_SQL,
  ENGAGEMENT_BUCKETS,
} from "./maleEngagementBuckets.service.js";
import { ensureUserEngagementStatsSchema } from "./userEngagementSchema.service.js";
import { ensureUserSchema } from "./userSchema.service.js";

const MAX_PAGE_SIZE = 100;

const paginate = (page, limit) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), MAX_PAGE_SIZE);
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
};

const getDisplayName = (row) =>
  String(row?.nickname || "").trim() ||
  (String(row?.name || "").trim() !== "New User"
    ? String(row?.name || "").trim()
    : "") ||
  String(row?.username || "").trim() ||
  String(row?.phone || "").trim() ||
  `User ${row.id}`;

const MALE_USERS_WHERE =
  "LOWER(COALESCE(u.gender, '')) = 'male' AND COALESCE(u.accountStatus, '') <> 'deleted'";

const BASE_FROM = `
  FROM users u
  LEFT JOIN user_engagement_stats ues ON ues.userId = u.id
`;

const STATUS_FILTER_MAP = {
  all: null,
  active_today: ENGAGEMENT_BUCKETS.ACTIVE_TODAY,
  active_7d: "ACTIVE_WITHIN_7D",
  active_30d: "ACTIVE_WITHIN_30D",
  at_risk: ENGAGEMENT_BUCKETS.AT_RISK_8_14_DAYS,
  dormant: "DORMANT_ANY",
  never_active: ENGAGEMENT_BUCKETS.NEVER_ACTIVE,
  ACTIVE_TODAY: ENGAGEMENT_BUCKETS.ACTIVE_TODAY,
  ACTIVE_1_7_DAYS: ENGAGEMENT_BUCKETS.ACTIVE_1_7_DAYS,
  AT_RISK_8_14_DAYS: ENGAGEMENT_BUCKETS.AT_RISK_8_14_DAYS,
  DORMANT_15_30_DAYS: ENGAGEMENT_BUCKETS.DORMANT_15_30_DAYS,
  DORMANT_31_60_DAYS: ENGAGEMENT_BUCKETS.DORMANT_31_60_DAYS,
  DORMANT_60_PLUS_DAYS: ENGAGEMENT_BUCKETS.DORMANT_60_PLUS_DAYS,
  NEVER_ACTIVE: ENGAGEMENT_BUCKETS.NEVER_ACTIVE,
};

export const parseMaleEngagementStatusQuery = (status = "all") => {
  const trimmed = String(status ?? "").trim();
  if (!trimmed || trimmed === "all") {
    return null;
  }

  if (!Object.hasOwn(STATUS_FILTER_MAP, trimmed)) {
    const error = new Error("Invalid status filter");
    error.statusCode = 400;
    throw error;
  }

  return STATUS_FILTER_MAP[trimmed];
};

const buildFilters = ({
  search = "",
  statusFilter = null,
  from = "",
  to = "",
  hasAppOpen = "",
  hasSession = "",
  hasChat = "",
  hasCall = "",
  hasRecharge = "",
  todayIstDate,
}) => {
  const whereParts = [MALE_USERS_WHERE];
  const replacements = { todayIstDate };

  if (String(search || "").trim()) {
    whereParts.push(`(
      u.name LIKE :searchLike OR
      u.nickname LIKE :searchLike OR
      u.username LIKE :searchLike OR
      u.phone LIKE :searchLike OR
      u.publicUserId LIKE :searchLike OR
      CAST(u.id AS CHAR) LIKE :searchLike
    )`);
    replacements.searchLike = `%${String(search).trim()}%`;
  }

  const normalizedStatus = statusFilter;
  const bucketExpr = `(${ENGAGEMENT_BUCKET_SQL})`;

  if (normalizedStatus === "ACTIVE_WITHIN_7D") {
    whereParts.push(`ues.last_meaningful_activity_at IS NOT NULL`);
    whereParts.push(`(${DAYS_SINCE_MEANINGFUL_SQL}) <= 7`);
  } else if (normalizedStatus === "ACTIVE_WITHIN_30D") {
    whereParts.push(`ues.last_meaningful_activity_at IS NOT NULL`);
    whereParts.push(`(${DAYS_SINCE_MEANINGFUL_SQL}) <= 30`);
  } else if (normalizedStatus === "DORMANT_ANY") {
    whereParts.push(`${bucketExpr} IN (
      '${ENGAGEMENT_BUCKETS.DORMANT_15_30_DAYS}',
      '${ENGAGEMENT_BUCKETS.DORMANT_31_60_DAYS}',
      '${ENGAGEMENT_BUCKETS.DORMANT_60_PLUS_DAYS}'
    )`);
  } else if (normalizedStatus) {
    whereParts.push(`${bucketExpr} = :statusBucket`);
    replacements.statusBucket = normalizedStatus;
  }

  if (from) {
    whereParts.push(`ues.last_meaningful_activity_at >= :fromUtc`);
    replacements.fromUtc = istDateKeyToUtcRange(from).start;
  }

  if (to) {
    whereParts.push(`ues.last_meaningful_activity_at <= :toUtc`);
    replacements.toUtc = istDateKeyToUtcRange(to).end;
  }

  const flag = (value) =>
    value === "true" || value === "1" || value === true;

  if (flag(hasAppOpen)) {
    whereParts.push("ues.last_app_open_at IS NOT NULL");
  }
  if (flag(hasSession)) {
    whereParts.push("ues.last_session_started_at IS NOT NULL");
  }
  if (flag(hasChat)) {
    whereParts.push("ues.last_chat_at IS NOT NULL");
  }
  if (flag(hasCall)) {
    whereParts.push("ues.last_call_at IS NOT NULL");
  }
  if (flag(hasRecharge)) {
    whereParts.push("ues.last_recharge_at IS NOT NULL");
  }

  return {
    whereSql: whereParts.join(" AND "),
    replacements,
  };
};

const mapRow = (row) => ({
  id: Number(row.id),
  publicUserId: row.publicUserId || "",
  displayName: getDisplayName(row),
  phone: row.phone || "",
  avatar: row.avatar || null,
  engagementStatus: row.engagementStatus,
  daysSinceMeaningfulActivity:
    row.daysSinceMeaningfulActivity == null
      ? null
      : Number(row.daysSinceMeaningfulActivity),
  lastMeaningfulActivityAt: row.last_meaningful_activity_at || null,
  lastAppOpenAt: row.last_app_open_at || null,
  lastSessionStartedAt: row.last_session_started_at || null,
  lastCreatorProfileViewedAt: row.last_creator_profile_viewed_at || null,
  lastChatAt: row.last_chat_at || null,
  lastCallAt: row.last_call_at || null,
  lastRechargeAt: row.last_recharge_at || null,
  lastAuthLoginAt: row.last_auth_login_at || null,
});

const fetchReactivationCounts = async ({ todayIstDate, from7Key, from30Key }) => {
  const from7Utc = istDateKeyToUtcRange(from7Key).start;
  const from30Utc = istDateKeyToUtcRange(from30Key).start;

  const reactivationSql = `
    SELECT COUNT(DISTINCT ge.userId) AS count
    FROM growth_events ge
    INNER JOIN users u ON u.id = ge.userId
    WHERE ${MALE_USERS_WHERE.replace(/u\./g, "u.")}
      AND ge.eventName = 'SESSION_STARTED'
      AND ge.createdAt >= :fromUtc
      AND EXISTS (
        SELECT 1
        FROM growth_events ge_prev
        WHERE ge_prev.userId = ge.userId
          AND ge_prev.eventName = 'SESSION_STARTED'
          AND ge_prev.createdAt < ge.createdAt
          AND DATEDIFF(
            DATE(DATE_ADD(ge.createdAt, INTERVAL 330 MINUTE)),
            DATE(DATE_ADD(ge_prev.createdAt, INTERVAL 330 MINUTE))
          ) >= :gapDays
      )`;

  const [row7] = await sequelize.query(reactivationSql, {
    replacements: { fromUtc: from7Utc, gapDays: 7, todayIstDate },
    type: QueryTypes.SELECT,
  });

  const [row30] = await sequelize.query(reactivationSql, {
    replacements: { fromUtc: from30Utc, gapDays: 30, todayIstDate },
    type: QueryTypes.SELECT,
  });

  return {
    reactivated7Days: Number(row7?.count) || 0,
    reactivated30Days: Number(row30?.count) || 0,
    reactivationMethod:
      "Distinct males with SESSION_STARTED in window after prior SESSION_STARTED at least N IST calendar days earlier (growth_events). Does not capture all meaningful-activity reactivations.",
  };
};

export const getMaleEngagementDashboard = async ({
  search = "",
  status = "all",
  from = "",
  to = "",
  hasAppOpen = "",
  hasSession = "",
  hasChat = "",
  hasCall = "",
  hasRecharge = "",
  page = 1,
  limit = 25,
  now = new Date(),
} = {}) => {
  const statusFilter = parseMaleEngagementStatusQuery(status);

  await Promise.all([ensureUserSchema(), ensureUserEngagementStatsSchema()]);

  const todayIstDate = toIstDateKey(now);
  const from7Key = addIstDays(todayIstDate, -6);
  const from30Key = addIstDays(todayIstDate, -29);

  const { page: safePage, limit: safeLimit, offset } = paginate(page, limit);
  const { whereSql, replacements } = buildFilters({
    search,
    statusFilter,
    from,
    to,
    hasAppOpen,
    hasSession,
    hasChat,
    hasCall,
    hasRecharge,
    todayIstDate,
  });

  const bucketExpr = ENGAGEMENT_BUCKET_SQL;
  const daysExpr = DAYS_SINCE_MEANINGFUL_SQL;

  const selectList = `
    u.id,
    u.publicUserId,
    u.name,
    u.nickname,
    u.username,
    u.phone,
    u.avatar,
    ues.last_meaningful_activity_at,
    ues.last_app_open_at,
    ues.last_session_started_at,
    ues.last_creator_profile_viewed_at,
    ues.last_chat_at,
    ues.last_call_at,
    ues.last_recharge_at,
    ues.last_auth_login_at,
    ${daysExpr} AS daysSinceMeaningfulActivity,
    ${bucketExpr} AS engagementStatus
  `;

  const pagingReplacements = {
    ...replacements,
    limit: safeLimit,
    offset,
  };

  const summarySql = `
    SELECT
      COUNT(*) AS totalMales,
      SUM(CASE WHEN ${bucketExpr} = '${ENGAGEMENT_BUCKETS.ACTIVE_TODAY}' THEN 1 ELSE 0 END) AS activeToday,
      SUM(CASE WHEN ues.last_meaningful_activity_at IS NOT NULL AND (${daysExpr}) <= 7 THEN 1 ELSE 0 END) AS active7Days,
      SUM(CASE WHEN ues.last_meaningful_activity_at IS NOT NULL AND (${daysExpr}) <= 30 THEN 1 ELSE 0 END) AS active30Days,
      SUM(CASE WHEN ${bucketExpr} = '${ENGAGEMENT_BUCKETS.AT_RISK_8_14_DAYS}' THEN 1 ELSE 0 END) AS atRisk8To14Days,
      SUM(CASE WHEN ${bucketExpr} = '${ENGAGEMENT_BUCKETS.DORMANT_60_PLUS_DAYS}' THEN 1 ELSE 0 END) AS dormant60PlusDays,
      SUM(CASE WHEN ${bucketExpr} = '${ENGAGEMENT_BUCKETS.NEVER_ACTIVE}' THEN 1 ELSE 0 END) AS neverActive
    ${BASE_FROM}
    WHERE ${whereSql}`;

  const [countRow, summaryRow, rows, reactivation] = await Promise.all([
    sequelize.query(
      `SELECT COUNT(*) AS total ${BASE_FROM} WHERE ${whereSql}`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(summarySql, { replacements, type: QueryTypes.SELECT }),
    sequelize.query(
      `SELECT ${selectList}
       ${BASE_FROM}
       WHERE ${whereSql}
       ORDER BY ues.last_meaningful_activity_at IS NULL ASC,
                ues.last_meaningful_activity_at DESC,
                u.id DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: pagingReplacements, type: QueryTypes.SELECT }
    ),
    fetchReactivationCounts({ todayIstDate, from7Key, from30Key }),
  ]);

  const total = Number(countRow[0]?.total) || 0;
  const summaryRaw = summaryRow[0] || {};

  return {
    data: rows.map(mapRow),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
    summary: {
      totalMales: Number(summaryRaw.totalMales) || 0,
      activeToday: Number(summaryRaw.activeToday) || 0,
      active7Days: Number(summaryRaw.active7Days) || 0,
      active30Days: Number(summaryRaw.active30Days) || 0,
      atRisk8To14Days: Number(summaryRaw.atRisk8To14Days) || 0,
      dormant60PlusDays: Number(summaryRaw.dormant60PlusDays) || 0,
      neverActive: Number(summaryRaw.neverActive) || 0,
      reactivated7Days: reactivation.reactivated7Days,
      reactivated30Days: reactivation.reactivated30Days,
    },
    meta: {
      timezone: ENGAGEMENT_BUCKET_DEFINITIONS.timezone,
      todayIstDate,
      bucketDefinitions: ENGAGEMENT_BUCKET_DEFINITIONS.buckets,
      summaryDefinitions: {
        activeToday: "Males in ACTIVE_TODAY bucket (meaningful activity on IST today).",
        active7Days:
          "Males with meaningful activity within the last 7 IST calendar days (daysSince <= 7).",
        active30Days:
          "Males with meaningful activity within the last 30 IST calendar days (daysSince <= 30).",
        atRisk8To14Days: "Males in AT_RISK_8_14_DAYS bucket.",
        dormant60PlusDays: "Males in DORMANT_60_PLUS_DAYS bucket (61+ days).",
        neverActive: "Males in NEVER_ACTIVE bucket.",
        reactivated7Days: reactivation.reactivationMethod,
        reactivated30Days: reactivation.reactivationMethod,
      },
    },
  };
};
