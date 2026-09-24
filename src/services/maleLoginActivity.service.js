import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

/** Maximum male rows loaded from DB (matches legacy endpoint). */
export const MALE_LOGIN_ACTIVITY_ROW_LIMIT = 2000;

const MALE_GENDER_WHERE = "u.gender IN ('Male', 'male')";

const USER_ORDER_SQL =
  "COALESCE(u.lastLoginAt, u.lastSeen, u.updatedAt) DESC";

const USER_SELECT_COLUMNS = `
  u.id,
  u.publicUserId,
  u.name,
  u.nickname,
  u.username,
  u.phone,
  u.avatar,
  u.online,
  u.lastSeen,
  u.lastLoginAt,
  u.createdAt,
  u.updatedAt`;

/**
 * Optimized server-side query: two pre-aggregations + LEFT JOIN (no correlated subqueries).
 */
export const buildMaleLoginActivitySql = (limit = MALE_LOGIN_ACTIVITY_ROW_LIMIT) => `
  SELECT
    ${USER_SELECT_COLUMNS},
    dt_agg.lastAppOpenAt,
    log_agg.lastOnlineLogAt
  FROM users u
  LEFT JOIN (
    SELECT userId, MAX(updatedAt) AS lastAppOpenAt
    FROM device_tokens
    GROUP BY userId
  ) dt_agg ON dt_agg.userId = u.id
  LEFT JOIN (
    SELECT userId, MAX(cameOnlineAt) AS lastOnlineLogAt
    FROM user_online_logs
    GROUP BY userId
  ) log_agg ON log_agg.userId = u.id
  WHERE ${MALE_GENDER_WHERE}
  ORDER BY ${USER_ORDER_SQL}
  LIMIT ${Number(limit)}`;

export const getDisplayName = (row) =>
  row.nickname ||
  (row.name && row.name !== "New User" ? row.name : null) ||
  row.username ||
  row.phone ||
  `User ${row.id}`;

export const pickLatestTimestamp = (...values) => {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return timestamps[0] || null;
};

export const mapMaleLoginActivityRow = (row) => {
  const lastLoginAt = row.lastLoginAt || null;
  const lastAppOpenAt = row.lastAppOpenAt || null;
  const lastOnlineLogAt = row.lastOnlineLogAt || null;
  const lastSeen = row.lastSeen || null;
  const lastActivityAt = pickLatestTimestamp(
    lastLoginAt,
    lastAppOpenAt,
    lastOnlineLogAt,
    lastSeen,
    row.updatedAt
  );

  return {
    id: Number(row.id),
    publicUserId: row.publicUserId || "",
    displayName: getDisplayName(row),
    phone: row.phone || "—",
    avatar: row.avatar || null,
    online: Boolean(row.online),
    lastLoginAt,
    lastAppOpenAt,
    lastOnlineLogAt,
    lastSeen,
    lastActivityAt,
    registeredAt: row.createdAt,
    hasLoginRecord: Boolean(lastLoginAt),
    hasAppOpenRecord: Boolean(lastAppOpenAt),
  };
};

export const applyMaleLoginActivitySearch = (rows, search = "") => {
  const trimmed = String(search || "").trim();
  if (!trimmed) {
    return rows;
  }

  const query = trimmed.toLowerCase();
  const compact = query.replace(/[^a-z0-9]/g, "");

  return rows.filter((row) => {
    const values = [row.displayName, row.phone, row.publicUserId, String(row.id)]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return values.some((value) => {
      const compactValue = value.replace(/[^a-z0-9]/g, "");
      return (
        value.includes(query) || (compact && compactValue.includes(compact))
      );
    });
  });
};

export const applyMaleLoginInactiveDaysFilter = (rows, inactiveDays = 0) => {
  const days = Math.max(0, Number(inactiveDays) || 0);
  if (days <= 0) {
    return rows;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return rows.filter((row) => {
    if (!row.lastActivityAt) {
      return true;
    }

    return new Date(row.lastActivityAt).getTime() < cutoff;
  });
};

export const buildMaleLoginActivitySummary = (rows) => ({
  totalMales: rows.length,
  loggedInTracked: rows.filter((row) => row.hasLoginRecord).length,
  appOpenTracked: rows.filter((row) => row.hasAppOpenRecord).length,
  onlineNow: rows.filter((row) => row.online).length,
  inactive7Days: rows.filter((row) => {
    if (!row.lastActivityAt) {
      return true;
    }

    return (
      Date.now() - new Date(row.lastActivityAt).getTime() >=
      7 * 24 * 60 * 60 * 1000
    );
  }).length,
});

export const MALE_LOGIN_ACTIVITY_NOTES = {
  lastLoginAt:
    "Recorded on OTP/PIN login after backend update. Older logins may be empty.",
  lastAppOpenAt:
    "Captured when the app opens with an active session and registers push token. No mobile change needed.",
  lastActivityAt:
    "Best available timestamp from login, app open, online log, or last seen.",
};

export const fetchMaleLoginActivityRows = async (
  limit = MALE_LOGIN_ACTIVITY_ROW_LIMIT
) => {
  const sql = buildMaleLoginActivitySql(limit);
  return sequelize.query(sql, { type: QueryTypes.SELECT });
};

export const getMaleLoginActivityReport = async ({
  search = "",
  inactiveDays = 0,
  limit = MALE_LOGIN_ACTIVITY_ROW_LIMIT,
} = {}) => {
  const rawRows = await fetchMaleLoginActivityRows(limit);
  let rows = rawRows.map(mapMaleLoginActivityRow);
  rows = applyMaleLoginActivitySearch(rows, search);
  rows = applyMaleLoginInactiveDaysFilter(rows, inactiveDays);

  return {
    summary: buildMaleLoginActivitySummary(rows),
    rows,
    notes: MALE_LOGIN_ACTIVITY_NOTES,
  };
};
