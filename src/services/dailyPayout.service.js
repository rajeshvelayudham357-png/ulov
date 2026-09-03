import { QueryTypes } from "sequelize";

import {
  getRevenueAnalyticsPeriodBounds,
  istDateKeyToUtcRange,
} from "./adminRevenueTime.service.js";
import { sequelize } from "../config/database.js";

const toAmount = (value) => Number(Number(value || 0).toFixed(2));

const PAYOUT_DATE_SQL = "DATE(DATE_ADD(w.createdAt, INTERVAL 330 MINUTE))";

export const getDailyPayoutReport = async ({
  period = "30d",
  startDate = "",
  endDate = "",
} = {}) => {
  const customFrom = String(startDate || "").trim();
  const customTo = String(endDate || "").trim();
  const resolvedPeriod =
    customFrom && customTo ? "custom" : String(period || "30d").trim();

  const { fromUtc, toUtc } = getRevenueAnalyticsPeriodBounds({
    period: resolvedPeriod,
    customFrom,
    customTo,
  });

  const dailyRows = await sequelize.query(
    `SELECT
       ${PAYOUT_DATE_SQL} AS date,
       COUNT(*) AS requestCount,
       COUNT(DISTINCT w.userId) AS uniqueCreators,
       COALESCE(SUM(w.amount), 0) AS totalRequested,
       SUM(CASE WHEN w.status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
       COALESCE(SUM(CASE WHEN w.status = 'pending' THEN w.amount ELSE 0 END), 0) AS pendingAmount,
       SUM(CASE WHEN w.status = 'approved' THEN 1 ELSE 0 END) AS approvedCount,
       COALESCE(SUM(CASE WHEN w.status = 'approved' THEN w.amount ELSE 0 END), 0) AS approvedAmount,
       SUM(CASE WHEN w.status = 'rejected' THEN 1 ELSE 0 END) AS rejectedCount,
       COALESCE(SUM(CASE WHEN w.status = 'rejected' THEN w.amount ELSE 0 END), 0) AS rejectedAmount
     FROM withdraws w
     INNER JOIN users u ON u.id = w.userId AND LOWER(u.gender) = 'female'
     WHERE w.createdAt >= :fromUtc
       AND w.createdAt <= :toUtc
     GROUP BY ${PAYOUT_DATE_SQL}
     ORDER BY date DESC`,
    {
      replacements: {
        fromUtc,
        toUtc,
      },
      type: QueryTypes.SELECT,
    }
  );

  const rows = dailyRows.map((row) => ({
    date: String(row.date),
    requestCount: Number(row.requestCount) || 0,
    uniqueCreators: Number(row.uniqueCreators) || 0,
    totalRequested: toAmount(row.totalRequested),
    pendingCount: Number(row.pendingCount) || 0,
    pendingAmount: toAmount(row.pendingAmount),
    approvedCount: Number(row.approvedCount) || 0,
    approvedAmount: toAmount(row.approvedAmount),
    rejectedCount: Number(row.rejectedCount) || 0,
    rejectedAmount: toAmount(row.rejectedAmount),
  }));

  const summary = rows.reduce(
    (acc, row) => {
      acc.dayCount += 1;
      acc.requestCount += row.requestCount;
      acc.uniqueCreators += row.uniqueCreators;
      acc.totalRequested += row.totalRequested;
      acc.pendingCount += row.pendingCount;
      acc.pendingAmount += row.pendingAmount;
      acc.approvedCount += row.approvedCount;
      acc.approvedAmount += row.approvedAmount;
      acc.rejectedCount += row.rejectedCount;
      acc.rejectedAmount += row.rejectedAmount;
      return acc;
    },
    {
      dayCount: 0,
      requestCount: 0,
      uniqueCreators: 0,
      totalRequested: 0,
      pendingCount: 0,
      pendingAmount: 0,
      approvedCount: 0,
      approvedAmount: 0,
      rejectedCount: 0,
      rejectedAmount: 0,
    }
  );

  summary.totalRequested = toAmount(summary.totalRequested);
  summary.pendingAmount = toAmount(summary.pendingAmount);
  summary.approvedAmount = toAmount(summary.approvedAmount);
  summary.rejectedAmount = toAmount(summary.rejectedAmount);

  return {
    period: resolvedPeriod,
    startDate:
      customFrom ||
      (rows.length > 0 ? rows[rows.length - 1].date : null),
    endDate:
      customTo || (rows.length > 0 ? rows[0].date : null),
    fromUtc,
    toUtc,
    summary,
    rows,
  };
};

export const resolveDailyPayoutBounds = ({
  startDate = "",
  endDate = "",
} = {}) => {
  const customFrom = String(startDate || "").trim();
  const customTo = String(endDate || "").trim();

  if (customFrom && customTo) {
    return {
      fromUtc: istDateKeyToUtcRange(customFrom).start,
      toUtc: istDateKeyToUtcRange(customTo).end,
    };
  }

  return getRevenueAnalyticsPeriodBounds({ period: "30d" });
};
