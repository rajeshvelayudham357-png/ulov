import { QueryTypes } from "sequelize";

import { QC_TABLES } from "../constants/quickConnect.js";
import { sequelize } from "../config/database.js";
import {
  addIstDays,
  istDateKeyToUtcRange,
  toIstDateKey,
} from "./adminRevenueTime.service.js";
import { getAdminUserDisplayName } from "./adminUsers.service.js";

const formatDuration = (seconds) => {
  const total = Number(seconds) || 0;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const resolveTargetDate = (rawDate = "") => {
  const trimmed = String(rawDate || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? trimmed
    : toIstDateKey(new Date());
};

const buildCallsQueryParts = ({ search = "" } = {}) => {
  const trimmedSearch = String(search || "").trim();
  const joins = `
    FROM call_histories ch
    LEFT JOIN users caller ON caller.id = ch.callerId
    LEFT JOIN users receiver ON receiver.id = ch.receiverId
    LEFT JOIN earnings e ON e.callId = ch.id
    LEFT JOIN (
      SELECT callHistoryId, MAX(failureReason) AS failureReason
      FROM ${QC_TABLES.ATTEMPTS}
      WHERE callHistoryId IS NOT NULL
      GROUP BY callHistoryId
    ) qca ON qca.callHistoryId = ch.id
  `;

  const whereParts = [
    "ch.createdAt >= :startDate",
    "ch.createdAt < :endDate",
  ];

  if (trimmedSearch) {
    whereParts.push(`(
      CAST(ch.id AS CHAR) LIKE :searchLike OR
      ch.status LIKE :searchLike OR
      ch.type LIKE :searchLike OR
      caller.name LIKE :searchLike OR
      caller.nickname LIKE :searchLike OR
      caller.username LIKE :searchLike OR
      caller.phone LIKE :searchLike OR
      receiver.name LIKE :searchLike OR
      receiver.nickname LIKE :searchLike OR
      receiver.username LIKE :searchLike OR
      receiver.phone LIKE :searchLike OR
      qca.failureReason LIKE :searchLike
    )`);
  }

  return {
    joins,
    whereSql: whereParts.join(" AND "),
    hasSearch: Boolean(trimmedSearch),
  };
};

export const getAdminCallsReport = async ({
  date = "",
  page = 1,
  limit = 50,
  search = "",
} = {}) => {
  const targetDate = resolveTargetDate(date);
  const startDate = istDateKeyToUtcRange(targetDate).start;
  const endDate = istDateKeyToUtcRange(addIstDays(targetDate, 1)).start;
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const offset = (safePage - 1) * safeLimit;

  const { joins, whereSql } = buildCallsQueryParts({ search });
  const replacements = {
    startDate,
    endDate,
    limit: safeLimit,
    offset,
  };

  if (String(search || "").trim()) {
    replacements.searchLike = `%${String(search).trim()}%`;
  }

  const [[countRow], rows] = await Promise.all([
    sequelize.query(
      `SELECT COUNT(DISTINCT ch.id) AS total
       ${joins}
       WHERE ${whereSql}`,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    ),
    sequelize.query(
      `SELECT ch.id,
              ch.type,
              ch.duration,
              ch.coinsSpent,
              ch.status,
              ch.createdAt,
              caller.id AS callerId,
              caller.name AS callerName,
              caller.nickname AS callerNickname,
              caller.username AS callerUsername,
              caller.phone AS callerPhone,
              caller.publicUserId AS callerPublicUserId,
              receiver.id AS receiverId,
              receiver.name AS receiverName,
              receiver.nickname AS receiverNickname,
              receiver.username AS receiverUsername,
              receiver.phone AS receiverPhone,
              receiver.publicUserId AS receiverPublicUserId,
              e.coins AS earningCoins,
              e.amount AS earningAmount,
              qca.failureReason,
              CASE
                WHEN qca.callHistoryId IS NOT NULL THEN 'quick_connect'
                ELSE 'direct'
              END AS source
       ${joins}
       WHERE ${whereSql}
       ORDER BY ch.createdAt DESC
       LIMIT :limit OFFSET :offset`,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    ),
  ]);

  const total = Number(countRow?.total) || 0;

  const formattedRows = rows.map((row) => {
    const coins = Number(row.coinsSpent) || Number(row.earningCoins) || 0;
    const earning =
      row.earningAmount != null
        ? Number(row.earningAmount)
        : Math.floor(coins * 0.5);

    return {
      id: row.id,
      male: getAdminUserDisplayName({
        id: row.callerId,
        name: row.callerName,
        nickname: row.callerNickname,
        username: row.callerUsername,
        phone: row.callerPhone,
        publicUserId: row.callerPublicUserId,
      }),
      female: getAdminUserDisplayName({
        id: row.receiverId,
        name: row.receiverName,
        nickname: row.receiverNickname,
        username: row.receiverUsername,
        phone: row.receiverPhone,
        publicUserId: row.receiverPublicUserId,
      }),
      duration: formatDuration(row.duration),
      coins,
      earning,
      type: row.type || "video",
      status: row.status || "completed",
      failureReason: row.failureReason || null,
      source: row.source === "quick_connect" ? "quick_connect" : "direct",
      startedAt: row.createdAt,
      createdAt: row.createdAt,
    };
  });

  return {
    rows: formattedRows,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    date: targetDate,
  };
};
