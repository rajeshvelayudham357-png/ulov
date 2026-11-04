import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIMIT = 200;

const parseDate = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
};

// Raw-query replacements format Date objects in the server's local time, but
// timestamps are stored in UTC, so bounds are passed as UTC strings.
const toUtcSql = (date) => date.toISOString().slice(0, 19).replace("T", " ");

const toPositiveInt = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

/**
 * Read-only comparison of each completed call's recorded cost with the coins
 * actually collected from the caller and the creator earning written for it.
 * Nothing here modifies data.
 */
export const getCallBillingReconciliation = async ({
  from,
  to,
  callerId,
  receiverId,
  onlyDiscrepancies = true,
  limit = 50,
  offset = 0,
} = {}) => {
  const now = new Date();
  const toDate = parseDate(to, now);
  const fromDate = parseDate(from, new Date(toDate.getTime() - 30 * DAY_MS));
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const callerFilter = toPositiveInt(callerId);
  const receiverFilter = toPositiveInt(receiverId);

  const replacements = {
    from: toUtcSql(fromDate),
    to: toUtcSql(toDate),
    callerId: callerFilter,
    receiverId: receiverFilter,
    limit: safeLimit,
    offset: safeOffset,
  };

  const filters = [
    "h.status = 'completed'",
    "h.createdAt >= :from",
    "h.createdAt < :to",
  ];

  if (callerFilter) {
    filters.push("h.callerId = :callerId");
  }

  if (receiverFilter) {
    filters.push("h.receiverId = :receiverId");
  }

  if (onlyDiscrepancies) {
    filters.push("COALESCE(h.coinsSpent, 0) > COALESCE(c.collected, 0)");
  }

  const where = filters.join(" AND ");

  // Debits are matched to calls by reference id and caller; the inner join to
  // call_histories keeps the aggregation limited to calls in the date range.
  const baseFrom = `
    FROM call_histories h
    LEFT JOIN (
      SELECT wt.referenceId AS callId, wt.userId, SUM(wt.amount) AS collected
      FROM wallet_transactions wt
      INNER JOIN call_histories hc
        ON hc.id = wt.referenceId
       AND hc.createdAt >= :from
       AND hc.createdAt < :to
      WHERE wt.type = 'debit'
        AND wt.referenceType = 'call'
      GROUP BY wt.referenceId, wt.userId
    ) c ON c.callId = h.id AND c.userId = h.callerId
    LEFT JOIN earnings e ON e.callId = h.id
  `;

  const recorded = "COALESCE(h.coinsSpent, 0)";
  const collected = "COALESCE(c.collected, 0)";
  const excessEarning = `
    CASE
      WHEN ${recorded} > 0 AND e.coins IS NOT NULL
        THEN GREATEST(0, e.coins - FLOOR(e.coins * LEAST(${collected}, ${recorded}) / ${recorded}))
      ELSE 0
    END
  `;

  const [summary] = await sequelize.query(
    `SELECT
       COUNT(*) AS calls,
       COALESCE(SUM(${recorded}), 0) AS recordedCost,
       COALESCE(SUM(${collected}), 0) AS collectedCoins,
       COALESCE(SUM(GREATEST(0, ${recorded} - ${collected})), 0) AS uncollectedCoins,
       COALESCE(SUM(e.coins), 0) AS earningCoins,
       COALESCE(SUM(e.amount), 0) AS earningAmount,
       COALESCE(SUM(${excessEarning}), 0) AS excessEarningCoins,
       COALESCE(SUM(CASE WHEN e.status = 'pending' THEN ${excessEarning} ELSE 0 END), 0) AS pendingExcessEarningCoins
     ${baseFrom}
     WHERE ${where}`,
    { replacements, type: QueryTypes.SELECT }
  );

  const topCallers = await sequelize.query(
    `SELECT
       h.callerId,
       u.username AS callerName,
       COUNT(*) AS calls,
       SUM(${recorded}) AS recordedCost,
       SUM(${collected}) AS collectedCoins,
       SUM(GREATEST(0, ${recorded} - ${collected})) AS uncollectedCoins
     ${baseFrom}
     LEFT JOIN users u ON u.id = h.callerId
     WHERE ${where}
     GROUP BY h.callerId, u.username
     ORDER BY uncollectedCoins DESC
     LIMIT 20`,
    { replacements, type: QueryTypes.SELECT }
  );

  const rows = await sequelize.query(
    `SELECT
       h.id AS callId,
       h.callerId,
       cu.username AS callerName,
       h.receiverId,
       ru.username AS receiverName,
       h.type,
       h.duration,
       ${recorded} AS recordedCost,
       ${collected} AS collectedCoins,
       GREATEST(0, ${recorded} - ${collected}) AS uncollectedCoins,
       e.coins AS earningCoins,
       e.amount AS earningAmount,
       e.status AS earningStatus,
       ${excessEarning} AS excessEarningCoins,
       h.acceptedAt,
       h.settledAt,
       h.endReason,
       h.createdAt
     ${baseFrom}
     LEFT JOIN users cu ON cu.id = h.callerId
     LEFT JOIN users ru ON ru.id = h.receiverId
     WHERE ${where}
     ORDER BY uncollectedCoins DESC, h.id DESC
     LIMIT :limit OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT }
  );

  const toNumber = (value) => Number(value || 0);

  return {
    generatedAt: now.toISOString(),
    filters: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      callerId: callerFilter,
      receiverId: receiverFilter,
      onlyDiscrepancies: Boolean(onlyDiscrepancies),
    },
    summary: {
      calls: toNumber(summary?.calls),
      recordedCost: toNumber(summary?.recordedCost),
      collectedCoins: toNumber(summary?.collectedCoins),
      uncollectedCoins: toNumber(summary?.uncollectedCoins),
      earningCoins: toNumber(summary?.earningCoins),
      earningAmount: Number(toNumber(summary?.earningAmount).toFixed(2)),
      excessEarningCoins: toNumber(summary?.excessEarningCoins),
      pendingExcessEarningCoins: toNumber(summary?.pendingExcessEarningCoins),
    },
    topCallers: topCallers.map((row) => ({
      callerId: Number(row.callerId),
      callerName: row.callerName,
      calls: toNumber(row.calls),
      recordedCost: toNumber(row.recordedCost),
      collectedCoins: toNumber(row.collectedCoins),
      uncollectedCoins: toNumber(row.uncollectedCoins),
    })),
    rows: rows.map((row) => ({
      ...row,
      callId: Number(row.callId),
      callerId: Number(row.callerId),
      receiverId: Number(row.receiverId),
      duration: toNumber(row.duration),
      recordedCost: toNumber(row.recordedCost),
      collectedCoins: toNumber(row.collectedCoins),
      uncollectedCoins: toNumber(row.uncollectedCoins),
      earningCoins: row.earningCoins === null ? null : toNumber(row.earningCoins),
      earningAmount: row.earningAmount === null ? null : Number(row.earningAmount),
      excessEarningCoins: toNumber(row.excessEarningCoins),
    })),
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      total: toNumber(summary?.calls),
    },
  };
};
