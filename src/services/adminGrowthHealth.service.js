import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { ACTIVE_CALL_STATUSES } from "./callState.service.js";
import { getGrowthThresholds } from "./adminGrowthThresholds.service.js";
import {
  CALL_FAILED_SQL,
  getCallCountSummary,
  getPaymentAggregates,
  safeRate,
} from "./adminGrowthMetrics.service.js";
import { getCallQualityMetrics } from "./adminGrowthCalls.service.js";

const healthStatus = (value, { green, yellow }) => {
  if (value >= green) {
    return "green";
  }
  if (value >= yellow) {
    return "yellow";
  }
  return "red";
};

export const getLiveHealthStatus = async () => {
  const thresholds = await getGrowthThresholds();

  const [
    onlineUsersRow,
    onlineCreatorsRow,
    activeCallsRow,
    pendingCallsRow,
    failedCallsTodayRow,
    todayPaymentsRow,
  ] = await Promise.all([
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users WHERE online = 1`,
      { type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE gender IN ('Female','female')
         AND accountStatus = 'approved'
         AND online = 1`,
      { type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM call_histories
       WHERE status IN (:statuses)`,
      {
        replacements: { statuses: ACTIVE_CALL_STATUSES },
        type: QueryTypes.SELECT,
      }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM call_histories
       WHERE status IN ('live','ringing')`,
      { type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM call_histories
       WHERE ${CALL_FAILED_SQL}
         AND createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      { type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue
       FROM payment_orders
       WHERE status IN ('PAID','SUCCESS','CAPTURED','credited','COMPLETED','completed','success','paid')
         AND updatedAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      { type: QueryTypes.SELECT }
    ),
  ]);

  const onlineCreators = Number(onlineCreatorsRow[0]?.count) || 0;
  const onlineUsers = Number(onlineUsersRow[0]?.count) || 0;
  const activeCalls = Number(activeCallsRow[0]?.count) || 0;
  const pendingCalls = Number(pendingCallsRow[0]?.count) || 0;
  const failedCalls24h = Number(failedCallsTodayRow[0]?.count) || 0;
  const revenue24h = Number(todayPaymentsRow[0]?.revenue) || 0;

  const nowBounds = {
    fromUtc: new Date(Date.now() - 24 * 60 * 60 * 1000),
    toUtc: new Date(),
  };

  const callQuality = await getCallQualityMetrics(nowBounds);
  const callSuccessRate = callQuality.metrics.callSuccessRate || 0;

  return {
    realtime: true,
    asOf: new Date().toISOString(),
    thresholds,
    metrics: {
      onlineUsers: {
        value: onlineUsers,
        status: "green",
      },
      onlineCreators: {
        value: onlineCreators,
        status:
          onlineCreators >= thresholds.minHealthyOnlineCreators
            ? "green"
            : onlineCreators >= thresholds.minOnlineCreators
              ? "yellow"
              : "red",
        label:
          onlineCreators < thresholds.minOnlineCreators
            ? "Critical"
            : onlineCreators < thresholds.minHealthyOnlineCreators
              ? "Needs attention"
              : "Healthy",
      },
      activeCalls: {
        value: activeCalls,
        status: "green",
      },
      availableCreators: {
        value: onlineCreators,
        status:
          onlineCreators >= thresholds.minOnlineCreators ? "green" : "red",
      },
      pendingCalls: {
        value: pendingCalls,
        status: pendingCalls > 10 ? "yellow" : "green",
      },
      failedCalls24h: {
        value: failedCalls24h,
        status:
          failedCalls24h > 50 ? "red" : failedCalls24h > 20 ? "yellow" : "green",
      },
      callSuccess: {
        value: callSuccessRate,
        status: healthStatus(callSuccessRate, {
          green: thresholds.minCallSuccessRatePct,
          yellow: thresholds.minCallSuccessRatePct * 0.75,
        }),
        label:
          callSuccessRate < thresholds.minCallSuccessRatePct
            ? "Needs attention"
            : "Healthy",
      },
      revenue24h: {
        value: revenue24h,
        status: revenue24h > 0 ? "green" : "yellow",
        label: revenue24h > 0 ? "Healthy" : "No recharges in last 24h",
      },
    },
  };
};

export const getHealthForPeriod = async (bounds) => {
  const [callSummary, payments, callQuality] = await Promise.all([
    getCallCountSummary(bounds),
    getPaymentAggregates(bounds),
    getCallQualityMetrics(bounds),
  ]);

  return {
    periodScoped: true,
    totalCalls: callSummary.totalCalls,
    callsGt30Sec: callSummary.callsGt30Sec,
    grossRevenue: payments.grossRevenue,
    callSuccessRate: callQuality.metrics.callSuccessRate,
    creatorAnswerRate: callQuality.metrics.creatorAnswerRate,
  };
};
