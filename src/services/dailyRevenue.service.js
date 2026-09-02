import { QueryTypes } from "sequelize";

import {
  IST_DATE_SQL,
  getRevenueAnalyticsPeriodBounds,
  istDateKeyToUtcRange,
} from "./adminRevenueTime.service.js";
import { getGstSettings, splitInclusiveGst } from "./gstSettings.service.js";
import { sequelize } from "../config/database.js";

const SUCCESS_STATUSES = ["PAID", "SUCCESS", "CAPTURED", "credited"];

const toAmount = (value) => Number(Number(value || 0).toFixed(2));

export const getDailyRevenueReport = async ({
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

  const gstSettings = await getGstSettings();
  const gstPercent = Number(gstSettings.gstPercent) || 0;

  const dailyRows = await sequelize.query(
    `SELECT
       ${IST_DATE_SQL} AS date,
       COUNT(*) AS rechargeCount,
       COUNT(DISTINCT userId) AS uniqueUsers,
       COALESCE(SUM(amount), 0) AS grossAmount,
       COALESCE(SUM(coins), 0) AS coinsPurchased
     FROM payment_orders
     WHERE status IN (:statuses)
       AND updatedAt >= :fromUtc
       AND updatedAt <= :toUtc
     GROUP BY ${IST_DATE_SQL}
     ORDER BY date DESC`,
    {
      replacements: {
        statuses: SUCCESS_STATUSES,
        fromUtc,
        toUtc,
      },
      type: QueryTypes.SELECT,
    }
  );

  const rows = dailyRows.map((row) => {
    const grossAmount = toAmount(row.grossAmount);
    const { gstAmount, baseRevenue } = splitInclusiveGst(grossAmount, gstPercent);

    return {
      date: String(row.date),
      rechargeCount: Number(row.rechargeCount) || 0,
      uniqueUsers: Number(row.uniqueUsers) || 0,
      grossAmount,
      gstPercent,
      gstAmount: toAmount(gstAmount),
      netRevenue: toAmount(baseRevenue),
      coinsPurchased: Number(row.coinsPurchased) || 0,
    };
  });

  const summary = rows.reduce(
    (acc, row) => {
      acc.dayCount += 1;
      acc.rechargeCount += row.rechargeCount;
      acc.uniqueUsers += row.uniqueUsers;
      acc.grossAmount += row.grossAmount;
      acc.gstAmount += row.gstAmount;
      acc.netRevenue += row.netRevenue;
      acc.coinsPurchased += row.coinsPurchased;
      return acc;
    },
    {
      dayCount: 0,
      rechargeCount: 0,
      uniqueUsers: 0,
      grossAmount: 0,
      gstAmount: 0,
      netRevenue: 0,
      coinsPurchased: 0,
      gstPercent,
    }
  );

  summary.grossAmount = toAmount(summary.grossAmount);
  summary.gstAmount = toAmount(summary.gstAmount);
  summary.netRevenue = toAmount(summary.netRevenue);

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

export const resolveDailyRevenueBounds = ({
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
