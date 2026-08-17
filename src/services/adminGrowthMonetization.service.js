import { QueryTypes } from "sequelize";

import { GROWTH_ACTIVITY_DEFINITION } from "../constants/growthMetricDefinitions.js";
import { sequelize } from "../config/database.js";
import {
  countActiveUsers,
  countRegisteredUsers,
  getPaymentAggregates,
  periodReplacements,
  roundMoney,
  safeRate,
} from "./adminGrowthMetrics.service.js";

export const getMonetizationMetrics = async (bounds) => {
  const replacements = periodReplacements(bounds);

  const [registered, active, payments, firstCallRow, repeatPayerDetail] =
    await Promise.all([
      countRegisteredUsers(bounds),
      countActiveUsers(bounds),
      getPaymentAggregates(bounds),
      sequelize.query(
        `SELECT COUNT(DISTINCT callerId) AS count
         FROM call_histories
         WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(DISTINCT userId) AS count
         FROM payment_orders
         WHERE status IN (:paymentStatuses)
           AND updatedAt >= :fromUtc AND updatedAt <= :toUtc
           AND userId IN (
             SELECT userId FROM payment_orders
             WHERE status IN (:paymentStatuses)
             GROUP BY userId HAVING COUNT(*) >= 2
           )`,
        { replacements, type: QueryTypes.SELECT }
      ),
    ]);

  const usersWithFirstCall = Number(firstCallRow[0]?.count) || 0;
  const grossRevenue = payments.grossRevenue;
  const payingUsers = payments.payingUsers;
  const repeatPayers = Number(repeatPayerDetail[0]?.count) || 0;

  const avgRecharge =
    payments.transactionCount > 0
      ? roundMoney(grossRevenue / payments.transactionCount)
      : 0;
  const arppu =
    payingUsers > 0 ? roundMoney(grossRevenue / payingUsers) : 0;
  const arpu = active > 0 ? roundMoney(grossRevenue / active) : 0;

  return {
    activityDefinition: GROWTH_ACTIVITY_DEFINITION,
    funnel: {
      registeredUsers: registered,
      activeUsers: active,
      usersWithFirstCall,
      firstTimePayers: payments.firstTimePayers,
      repeatPayers,
      rechargeTransactions: payments.transactionCount,
      rechargeRevenue: roundMoney(grossRevenue),
      averageRecharge: avgRecharge,
      averageRevenuePerPayer: arppu,
      revenuePerRegisteredUser:
        registered > 0 ? roundMoney(grossRevenue / registered) : 0,
    },
    rates: {
      payerConversionRate: safeRate(payingUsers, registered),
      repeatPayerRate: safeRate(repeatPayers, payingUsers),
      arpu,
      arppu,
    },
    payerDefinitions: {
      firstTimePayer:
        "Users whose first-ever successful payment updatedAt falls within the selected IST period.",
      repeatPayer:
        "Users with 2+ lifetime successful payments who also made at least one payment in the selected period.",
      payingUser:
        "Distinct users with at least one successful payment updatedAt in the selected period.",
    },
  };
};

export const getPackagePerformance = async (bounds) => {
  const replacements = periodReplacements(bounds);

  const rows = await sequelize.query(
    `SELECT
       po.amount AS packageAmount,
       COUNT(*) AS purchases,
       COALESCE(SUM(po.amount), 0) AS revenue,
       COUNT(DISTINCT po.userId) AS uniqueUsers,
       SUM(CASE WHEN userPurchaseCounts.orderCount >= 2 THEN 1 ELSE 0 END) AS repeatPurchases
     FROM payment_orders po
     INNER JOIN (
       SELECT po_inner.userId, po_inner.amount, COUNT(*) AS orderCount
       FROM payment_orders po_inner
       WHERE po_inner.status IN (:paymentStatuses)
       GROUP BY po_inner.userId, po_inner.amount
     ) userPurchaseCounts
       ON userPurchaseCounts.userId = po.userId
      AND userPurchaseCounts.amount = po.amount
     WHERE po.status IN (:paymentStatuses)
       AND po.updatedAt >= :fromUtc
       AND po.updatedAt <= :toUtc
     GROUP BY po.amount
     ORDER BY revenue DESC`,
    { replacements, type: QueryTypes.SELECT }
  );

  const totalRevenue = rows.reduce(
    (sum, row) => sum + (Number(row.revenue) || 0),
    0
  );

  return {
    packages: rows.map((row) => {
      const revenue = Number(row.revenue) || 0;
      return {
        package: `₹${Number(row.packageAmount)}`,
        packageAmount: Number(row.packageAmount),
        purchases: Number(row.purchases) || 0,
        revenue: roundMoney(revenue),
        uniqueUsers: Number(row.uniqueUsers) || 0,
        repeatPurchases: Number(row.repeatPurchases) || 0,
        percentageOfRevenue: safeRate(revenue, totalRevenue),
      };
    }),
    totalRevenue: roundMoney(totalRevenue),
    note: "Packages are read dynamically from payment_orders.amount.",
  };
};

export const getFirstAndRepeatRechargeRevenue = async (bounds) => {
  const replacements = periodReplacements(bounds);

  const [firstRevenueRow, repeatRevenueRow, highestRow] = await Promise.all([
    sequelize.query(
      `SELECT COALESCE(SUM(po.amount), 0) AS revenue
       FROM payment_orders po
       INNER JOIN (
         SELECT userId, MIN(updatedAt) AS firstPaidAt
         FROM payment_orders
         WHERE status IN (:paymentStatuses)
         GROUP BY userId
       ) fp ON fp.userId = po.userId AND fp.firstPaidAt = po.updatedAt
       WHERE po.status IN (:paymentStatuses)
         AND po.updatedAt >= :fromUtc AND po.updatedAt <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COALESCE(SUM(po.amount), 0) AS revenue
       FROM payment_orders po
       WHERE po.status IN (:paymentStatuses)
         AND po.updatedAt >= :fromUtc AND po.updatedAt <= :toUtc
         AND po.userId IN (
           SELECT userId FROM payment_orders
           WHERE status IN (:paymentStatuses)
           GROUP BY userId HAVING COUNT(*) >= 2
         )
         AND po.updatedAt > (
           SELECT MIN(updatedAt) FROM payment_orders p2
           WHERE p2.userId = po.userId AND p2.status IN (:paymentStatuses)
         )`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COALESCE(MAX(amount), 0) AS highest
       FROM payment_orders
       WHERE status IN (:paymentStatuses)
         AND updatedAt >= :fromUtc AND updatedAt <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  return {
    firstRechargeRevenue: roundMoney(Number(firstRevenueRow[0]?.revenue) || 0),
    repeatRechargeRevenue: roundMoney(Number(repeatRevenueRow[0]?.revenue) || 0),
    highestRecharge: Number(highestRow[0]?.highest) || 0,
  };
};

export const getMonetizationBundle = async (bounds) => {
  const [metrics, packages, rechargeSplit] = await Promise.all([
    getMonetizationMetrics(bounds),
    getPackagePerformance(bounds),
    getFirstAndRepeatRechargeRevenue(bounds),
  ]);

  return {
    ...metrics,
    recharge: {
      ...rechargeSplit,
      ...metrics.funnel,
    },
    packages,
  };
};
