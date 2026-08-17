import { QueryTypes } from "sequelize";

import { GROWTH_METRIC_DEFINITIONS } from "../constants/growthMetricDefinitions.js";
import { sequelize } from "../config/database.js";
import { getGstSettings, splitInclusiveGst } from "./gstSettings.service.js";
import {
  ACTIVE_CALL_STATUSES,
  TERMINAL_CALL_STATUSES,
} from "./callState.service.js";

/** Matches revenueAnalytics success statuses in admin.controller.js */
export const SUCCESSFUL_PAYMENT_STATUSES = [
  "PAID",
  "SUCCESS",
  "CAPTURED",
  "credited",
  "COMPLETED",
  "completed",
  "success",
  "paid",
];

export const CALL_FAILED_STATUSES = [
  "missed",
  "rejected",
  "cancelled",
  "failed",
  "busy",
];

export const CALL_ACCEPTED_STATUSES = [
  "accepted",
  "completed",
  "ended",
  "ongoing",
  "in_progress",
];

export const isSuccessfulPayment = (status) =>
  SUCCESSFUL_PAYMENT_STATUSES.includes(String(status || "").trim());

export const unavailableMetric = (label = "Not configured", reason = null) => ({
  available: false,
  value: null,
  label,
  reason,
});

export const calculatePercentageChange = (current, previous) => {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;

  if (previousValue > 0) {
    return {
      available: true,
      value: Number(
        (((currentValue - previousValue) / previousValue) * 100).toFixed(1)
      ),
      label: "percent",
    };
  }

  if (previousValue === 0 && currentValue > 0) {
    return { available: true, value: "New", label: "new" };
  }

  return { available: true, value: "—", label: "neutral" };
};

export const safeRate = (numerator, denominator, digits = 1) => {
  const num = Number(numerator) || 0;
  const den = Number(denominator) || 0;
  if (den <= 0) {
    return null;
  }
  return Number(((num / den) * 100).toFixed(digits));
};

export const buildMetricWithComparison = ({
  key,
  label,
  current,
  previous,
  format = "number",
  definition = null,
}) => ({
  key,
  label,
  definition:
    definition ||
    GROWTH_METRIC_DEFINITIONS[key]?.definition ||
    null,
  current: format === "currency" ? roundMoney(current) : Number(current) || 0,
  previous: format === "currency" ? roundMoney(previous) : Number(previous) || 0,
  change: calculatePercentageChange(current, previous),
  format,
});

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const CALL_CONNECTED_SQL = `(COALESCE(duration, 0) > 0 OR status IN ('accepted','completed','ended','ongoing','in_progress'))`;

export const CALL_ACCEPTED_SQL = `(status IN ('accepted','completed','ended','ongoing','in_progress') OR COALESCE(duration, 0) > 0)`;

export const CALL_FAILED_SQL = `status IN ('missed','rejected','cancelled','failed','busy')`;

const periodReplacements = (bounds) => ({
  fromUtc: bounds.fromUtc,
  toUtc: bounds.toUtc,
  paymentStatuses: SUCCESSFUL_PAYMENT_STATUSES,
});

export const countRegisteredUsers = async (bounds) => {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS count
     FROM users
     WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );
  return Number(row?.count) || 0;
};

export const countActiveUsers = async (bounds) => {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS count
     FROM users
     WHERE lastSeen >= :fromUtc AND lastSeen <= :toUtc`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );
  return Number(row?.count) || 0;
};

export const getPaymentAggregates = async (bounds) => {
  const [row] = await sequelize.query(
    `SELECT
       COUNT(*) AS transactionCount,
       COUNT(DISTINCT userId) AS payingUsers,
       COALESCE(SUM(amount), 0) AS grossRevenue
     FROM payment_orders
     WHERE status IN (:paymentStatuses)
       AND updatedAt >= :fromUtc
       AND updatedAt <= :toUtc`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );

  const [firstTimeRow] = await sequelize.query(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT userId, MIN(updatedAt) AS firstPaidAt
       FROM payment_orders
       WHERE status IN (:paymentStatuses)
       GROUP BY userId
     ) first_payments
     WHERE firstPaidAt >= :fromUtc AND firstPaidAt <= :toUtc`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );

  const [repeatRow] = await sequelize.query(
    `SELECT COUNT(DISTINCT p.userId) AS count
     FROM payment_orders p
     INNER JOIN (
       SELECT userId
       FROM payment_orders
       WHERE status IN (:paymentStatuses)
       GROUP BY userId
       HAVING COUNT(*) >= 2
     ) repeaters ON repeaters.userId = p.userId
     WHERE p.status IN (:paymentStatuses)
       AND p.updatedAt >= :fromUtc
       AND p.updatedAt <= :toUtc`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );

  return {
    transactionCount: Number(row?.transactionCount) || 0,
    payingUsers: Number(row?.payingUsers) || 0,
    grossRevenue: Number(row?.grossRevenue) || 0,
    firstTimePayers: Number(firstTimeRow?.count) || 0,
    repeatPayers: Number(repeatRow?.count) || 0,
  };
};

export const getCreatorPayoutTotal = async (bounds) => {
  const [row] = await sequelize.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM withdraws
     WHERE status IN ('approved', 'completed', 'success')
       AND createdAt >= :fromUtc
       AND createdAt <= :toUtc`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );
  return Number(row?.total) || 0;
};

export const getCreatorEarningsTotal = async (bounds) => {
  const [row] = await sequelize.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM earnings
     WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );
  return Number(row?.total) || 0;
};

export const getCallCountSummary = async (bounds) => {
  const [row] = await sequelize.query(
    `SELECT
       COUNT(*) AS totalCalls,
       SUM(CASE WHEN ${CALL_CONNECTED_SQL} THEN 1 ELSE 0 END) AS connectedCalls,
       SUM(CASE WHEN COALESCE(duration, 0) >= 30 THEN 1 ELSE 0 END) AS callsGt30Sec
     FROM call_histories
     WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );

  return {
    totalCalls: Number(row?.totalCalls) || 0,
    connectedCalls: Number(row?.connectedCalls) || 0,
    callsGt30Sec: Number(row?.callsGt30Sec) || 0,
  };
};

export const getExecutiveSummary = async ({ current, previous }) => {
  const gstSettings = await getGstSettings();
  const gstPercent = Number(gstSettings.gstPercent) || 0;

  const [
    registeredCurrent,
    registeredPrevious,
    activeCurrent,
    activePrevious,
    paymentsCurrent,
    paymentsPrevious,
    callsCurrent,
    callsPrevious,
    payoutCurrent,
    payoutPrevious,
    earningsCurrent,
  ] = await Promise.all([
    countRegisteredUsers(current),
    countRegisteredUsers(previous),
    countActiveUsers(current),
    countActiveUsers(previous),
    getPaymentAggregates(current),
    getPaymentAggregates(previous),
    getCallCountSummary(current),
    getCallCountSummary(previous),
    getCreatorPayoutTotal(current),
    getCreatorPayoutTotal(previous),
    getCreatorEarningsTotal(current),
  ]);

  const netCurrent = splitInclusiveGst(
    paymentsCurrent.grossRevenue,
    gstPercent
  ).baseRevenue;
  const netPrevious = splitInclusiveGst(
    paymentsPrevious.grossRevenue,
    gstPercent
  ).baseRevenue;
  const gstCurrent = splitInclusiveGst(
    paymentsCurrent.grossRevenue,
    gstPercent
  ).gstAmount;

  const arppuCurrent =
    paymentsCurrent.payingUsers > 0
      ? roundMoney(
          paymentsCurrent.grossRevenue / paymentsCurrent.payingUsers
        )
      : 0;
  const arppuPrevious =
    paymentsPrevious.payingUsers > 0
      ? roundMoney(
          paymentsPrevious.grossRevenue / paymentsPrevious.payingUsers
        )
      : 0;

  const remainingCurrent = roundMoney(netCurrent - payoutCurrent);

  return {
    activityDefinition: "lastSeen",
    metrics: [
      buildMetricWithComparison({
        key: "REGISTERED_USERS",
        label: "Registered Users",
        current: registeredCurrent,
        previous: registeredPrevious,
      }),
      buildMetricWithComparison({
        key: "ACTIVE_USERS",
        label: "Active Users",
        current: activeCurrent,
        previous: activePrevious,
      }),
      buildMetricWithComparison({
        key: "REGISTERED_USERS",
        label: "New Users",
        current: registeredCurrent,
        previous: registeredPrevious,
        definition: "Same as registered users in the selected IST period.",
      }),
      buildMetricWithComparison({
        key: "PAYING_USERS",
        label: "Paying Users",
        current: paymentsCurrent.payingUsers,
        previous: paymentsPrevious.payingUsers,
      }),
      buildMetricWithComparison({
        key: "FIRST_TIME_PAYERS",
        label: "First-Time Payers",
        current: paymentsCurrent.firstTimePayers,
        previous: paymentsPrevious.firstTimePayers,
      }),
      buildMetricWithComparison({
        key: "TOTAL_CALLS",
        label: "Total Calls",
        current: callsCurrent.totalCalls,
        previous: callsPrevious.totalCalls,
      }),
      buildMetricWithComparison({
        key: "CALLS_GT_30_SEC",
        label: "Calls > 30 Seconds",
        current: callsCurrent.callsGt30Sec,
        previous: callsPrevious.callsGt30Sec,
      }),
      buildMetricWithComparison({
        key: "GROSS_REVENUE",
        label: "Recharge Revenue",
        current: paymentsCurrent.grossRevenue,
        previous: paymentsPrevious.grossRevenue,
        format: "currency",
      }),
      buildMetricWithComparison({
        key: "NET_REVENUE",
        label: "Net Revenue",
        current: netCurrent,
        previous: netPrevious,
        format: "currency",
      }),
      buildMetricWithComparison({
        key: "CREATOR_PAYOUT",
        label: "Creator Payout",
        current: payoutCurrent,
        previous: payoutPrevious,
        format: "currency",
      }),
      buildMetricWithComparison({
        key: "CONTRIBUTION",
        label: "Remaining Revenue",
        current: remainingCurrent,
        previous: roundMoney(netPrevious - payoutPrevious),
        format: "currency",
        definition:
          "Net revenue minus creator payouts in period. Other costs not deducted unless configured.",
      }),
      buildMetricWithComparison({
        key: "ARPPU",
        label: "Average Revenue Per Paying User",
        current: arppuCurrent,
        previous: arppuPrevious,
        format: "currency",
      }),
    ],
    details: {
      gst: roundMoney(gstCurrent),
      creatorEarnings: roundMoney(earningsCurrent),
      gstPercent,
    },
  };
};

const buildFunnelStage = ({
  id,
  label,
  count,
  previousCount = null,
  available = true,
  reason = null,
}) => {
  const stage = {
    id,
    label,
    count: available ? Number(count) || 0 : null,
    available,
    reason,
  };

  if (previousCount !== null && available) {
    stage.conversionFromPrevious = safeRate(count, previousCount);
  }

  return stage;
};

export const getGrowthFunnel = async (bounds) => {
  const replacements = periodReplacements(bounds);

  const [
    registrationRow,
    profileRow,
    chatRow,
    callStartedRow,
    callConnectedRow,
    call30Row,
    firstRechargeRow,
    repeatRechargeRow,
  ] = await Promise.all([
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc
         AND profileCompleted = 1`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(DISTINCT senderId) AS count
       FROM chat_messages
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM call_histories
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM call_histories
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc
         AND ${CALL_CONNECTED_SQL}`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM call_histories
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc
         AND COALESCE(duration, 0) >= 30`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT userId, MIN(updatedAt) AS firstPaidAt
         FROM payment_orders
         WHERE status IN (:paymentStatuses)
         GROUP BY userId
       ) fp
       WHERE firstPaidAt >= :fromUtc AND firstPaidAt <= :toUtc`,
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

  const registrations = Number(registrationRow[0]?.count) || 0;
  const profileCompleted = Number(profileRow[0]?.count) || 0;
  const chatStarted = Number(chatRow[0]?.count) || 0;
  const callStarted = Number(callStartedRow[0]?.count) || 0;
  const callConnected = Number(callConnectedRow[0]?.count) || 0;
  const call30 = Number(call30Row[0]?.count) || 0;
  const firstRecharge = Number(firstRechargeRow[0]?.count) || 0;
  const repeatRecharge = Number(repeatRechargeRow[0]?.count) || 0;

  const stages = [
    buildFunnelStage({
      id: "ad_impression",
      label: "Ad Impression",
      count: null,
      available: false,
      reason: "Not tracked",
    }),
    buildFunnelStage({
      id: "store_visit",
      label: "Store Visit",
      count: null,
      available: false,
      reason: "Not tracked",
    }),
    buildFunnelStage({
      id: "install",
      label: "Install",
      count: null,
      available: false,
      reason: "Not tracked",
    }),
    buildFunnelStage({
      id: "registration",
      label: "Registration",
      count: registrations,
    }),
    buildFunnelStage({
      id: "profile_completed",
      label: "Profile Completed",
      count: profileCompleted,
      previousCount: registrations,
    }),
    buildFunnelStage({
      id: "creator_viewed",
      label: "Creator Viewed",
      count: null,
      available: false,
      reason: "Not tracked",
    }),
    buildFunnelStage({
      id: "chat_started",
      label: "Chat Started",
      count: chatStarted,
      previousCount: profileCompleted || registrations,
    }),
    buildFunnelStage({
      id: "call_started",
      label: "Call Started",
      count: callStarted,
      previousCount: chatStarted || profileCompleted || registrations,
    }),
    buildFunnelStage({
      id: "call_connected",
      label: "Call Connected",
      count: callConnected,
      previousCount: callStarted,
    }),
    buildFunnelStage({
      id: "call_gt_30_sec",
      label: "Call > 30 Seconds",
      count: call30,
      previousCount: callConnected,
    }),
    buildFunnelStage({
      id: "first_recharge",
      label: "First Recharge",
      count: firstRecharge,
      previousCount: call30 || callConnected,
    }),
    buildFunnelStage({
      id: "repeat_recharge",
      label: "Repeat Recharge",
      count: repeatRecharge,
      previousCount: firstRecharge,
    }),
  ];

  stages.forEach((stage) => {
    if (stage.available && registrations > 0 && stage.count !== null) {
      stage.overallFromRegistration = safeRate(stage.count, registrations);
      stage.dropOffFromRegistration =
        stage.overallFromRegistration === null
          ? null
          : Number((100 - stage.overallFromRegistration).toFixed(1));
    }
  });

  return {
    stages,
    note: "Top-of-funnel and creator-view stages require event tracking (Phase 4). Chat started counts distinct senders with messages in period.",
    callStatusesReference: {
      active: ACTIVE_CALL_STATUSES,
      terminal: TERMINAL_CALL_STATUSES,
      failed: CALL_FAILED_STATUSES,
      accepted: CALL_ACCEPTED_STATUSES,
    },
  };
};

export {
  roundMoney,
  periodReplacements,
};
