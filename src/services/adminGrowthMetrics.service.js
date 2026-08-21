import { QueryTypes } from "sequelize";

import {
  GROWTH_FUNNEL_STAGE_SEMANTICS,
  GROWTH_METRIC_DEFINITIONS,
} from "../constants/growthMetricDefinitions.js";
import { FUNNEL_STAGE_EVENT_MAP, GROWTH_EVENT_NAMES } from "../constants/growthEventDefinitions.js";
import { sequelize } from "../config/database.js";
import {
  countGrowthEvents,
  hasGrowthEventsEver,
} from "./growthEvents.service.js";
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

export const callAcceptedSql = (alias = "") => {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}status IN ('accepted','completed','ended','ongoing','in_progress') OR COALESCE(${prefix}duration, 0) > 0)`;
};

/** Connected calls require actual connection evidence (duration or post-connect terminal status). */
export const callConnectedSql = (alias = "") => {
  const prefix = alias ? `${alias}.` : "";
  return `(COALESCE(${prefix}duration, 0) > 0 OR ${prefix}status IN ('completed','ended','ongoing','in_progress'))`;
};

/** Countable call attempts for totals — exclude transient ringing rows. */
export const callCountableSql = (alias = "") => {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}status NOT IN ('ringing')`;
};

export const callFailedSql = (alias = "") => {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}status IN ('missed','rejected','cancelled','failed','busy')`;
};

/** Single-table call_histories queries (no join ambiguity). */
export const CALL_ACCEPTED_SQL = callAcceptedSql();
export const CALL_CONNECTED_SQL = callConnectedSql();
export const CALL_FAILED_SQL = callFailedSql();

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

const evaluateFunnelConversion = ({
  stage,
  previousStage = null,
  registrationStage = null,
  semantics = {},
}) => {
  const {
    subsetOfPrevious = false,
    subsetOfRegistration = false,
    populationDefinition = null,
  } = semantics;

  const result = {
    populationDefinition,
    conversionComparable: false,
    conversionFromPrevious: null,
    conversionFromRegistration: null,
    dropOffFromRegistration: null,
    conversionUnavailableReason: null,
  };

  if (previousStage?.available) {
    if (previousStage.unit !== stage.unit) {
      result.conversionUnavailableReason = `Previous stage is ${previousStage.unit} while this stage is ${stage.unit}.`;
    } else if (!subsetOfPrevious) {
      result.conversionUnavailableReason =
        "Stages use different population definitions.";
    } else if (Number(stage.count) > Number(previousStage.count)) {
      result.conversionUnavailableReason =
        "Current stage exceeds previous stage; populations are not a sequential subset.";
    } else {
      result.conversionComparable = true;
      result.conversionFromPrevious = safeRate(
        stage.count,
        previousStage.count
      );
    }
  }

  if (registrationStage?.available && registrationStage.unit === stage.unit) {
    if (!subsetOfRegistration) {
      result.conversionFromRegistration = null;
      result.dropOffFromRegistration = null;
    } else if (Number(stage.count) > Number(registrationStage.count)) {
      result.conversionFromRegistration = null;
      result.dropOffFromRegistration = null;
    } else {
      result.conversionFromRegistration = safeRate(
        stage.count,
        registrationStage.count
      );
      if (result.conversionFromRegistration !== null) {
        result.dropOffFromRegistration = Number(
          (100 - result.conversionFromRegistration).toFixed(1)
        );
      }
    }
  } else if (
    registrationStage?.available &&
    registrationStage.unit !== stage.unit
  ) {
    result.conversionFromRegistration = null;
    result.dropOffFromRegistration = null;
  }

  return result;
};

const buildFunnelStage = ({
  id,
  label,
  count,
  unit,
  available = true,
  reason = null,
  previousStage = null,
  registrationStage = null,
  semantics = GROWTH_FUNNEL_STAGE_SEMANTICS[id] || {},
}) => {
  const stage = {
    id,
    label,
    count: available ? Number(count) || 0 : null,
    unit,
    available,
    reason,
    populationDefinition: semantics.populationDefinition || null,
    conversionComparable: false,
    conversionFromPrevious: null,
    conversionFromRegistration: null,
    dropOffFromRegistration: null,
    conversionUnavailableReason: null,
  };

  if (!available) {
    return stage;
  }

  const conversion = evaluateFunnelConversion({
    stage,
    previousStage,
    registrationStage,
    semantics,
  });

  return {
    ...stage,
    ...conversion,
  };
};

const buildTrackedStage = (config) =>
  buildFunnelStage({
    ...config,
    available: false,
    count: null,
    reason: config.reason || "Not tracked",
  });

const buildEventBackedStageDef = async (bounds, stageId, config) => {
  const eventName = FUNNEL_STAGE_EVENT_MAP[stageId];

  if (stageId === "ad_impression") {
    return buildTrackedStage({
      id: stageId,
      ...config,
      reason: "Ad integration not connected",
    });
  }

  if (!eventName) {
    return buildTrackedStage({ id: stageId, ...config });
  }

  const everTracked = await hasGrowthEventsEver(eventName);
  if (!everTracked) {
    return buildTrackedStage({ id: stageId, ...config, reason: "Not tracked" });
  }

  const count = await countGrowthEvents(bounds, {
    eventName,
    distinctUser: config.distinctUser,
    distinctAnonymous: config.distinctAnonymous,
  });

  return {
    id: stageId,
    ...config,
    count,
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS[stageId],
  };
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
    payments,
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
      `SELECT COUNT(*) AS count FROM call_histories ch
       WHERE ch.createdAt >= :fromUtc AND ch.createdAt <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM call_histories ch
       WHERE ch.createdAt >= :fromUtc AND ch.createdAt <= :toUtc
         AND ${callConnectedSql("ch")}`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM call_histories ch
       WHERE ch.createdAt >= :fromUtc AND ch.createdAt <= :toUtc
         AND COALESCE(ch.duration, 0) >= 30`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT po.userId, MIN(po.updatedAt) AS firstPaidAt
         FROM payment_orders po
         WHERE po.status IN (:paymentStatuses)
         GROUP BY po.userId
       ) fp
       WHERE fp.firstPaidAt >= :fromUtc AND fp.firstPaidAt <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(DISTINCT po.userId) AS count
       FROM payment_orders po
       WHERE po.status IN (:paymentStatuses)
         AND po.updatedAt >= :fromUtc AND po.updatedAt <= :toUtc
         AND po.userId IN (
           SELECT po2.userId FROM payment_orders po2
           WHERE po2.status IN (:paymentStatuses)
           GROUP BY po2.userId HAVING COUNT(*) >= 2
         )`,
      { replacements, type: QueryTypes.SELECT }
    ),
    getPaymentAggregates(bounds),
  ]);

  const registrations = Number(registrationRow[0]?.count) || 0;
  const profileCompleted = Number(profileRow[0]?.count) || 0;
  const chatStarted = Number(chatRow[0]?.count) || 0;
  const callStarted = Number(callStartedRow[0]?.count) || 0;
  const callConnected = Number(callConnectedRow[0]?.count) || 0;
  const call30 = Number(call30Row[0]?.count) || 0;
  const firstRecharge = Number(firstRechargeRow[0]?.count) || 0;
  const repeatRecharge = Number(repeatRechargeRow[0]?.count) || 0;

  const [
    adImpressionDef,
    storeVisitDef,
    installDef,
    creatorViewedDef,
  ] = await Promise.all([
    buildEventBackedStageDef(bounds, "ad_impression", {
      label: "Ad Impression",
      unit: "events",
    }),
    buildEventBackedStageDef(bounds, "store_visit", {
      label: "Store Visit",
      unit: "events",
    }),
    buildEventBackedStageDef(bounds, "install", {
      label: "Install",
      unit: "users",
      distinctAnonymous: true,
    }),
    buildEventBackedStageDef(bounds, "creator_viewed", {
      label: "Creator Viewed",
      unit: "users",
      distinctUser: true,
    }),
  ]);

  const userStageDefs = [
    adImpressionDef,
    storeVisitDef,
    installDef,
    {
      id: "registration",
      label: "Registration",
      count: registrations,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.registration,
    },
    {
      id: "profile_completed",
      label: "Profile Completed",
      count: profileCompleted,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.profile_completed,
    },
    creatorViewedDef,
    {
      id: "chat_started",
      label: "Chat Started",
      count: chatStarted,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.chat_started,
    },
    {
      id: "first_recharge",
      label: "First Recharge",
      count: firstRecharge,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.first_recharge,
    },
    {
      id: "repeat_recharge",
      label: "Repeat Recharge",
      count: repeatRecharge,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.repeat_recharge,
    },
  ];

  const registrationAnchor = {
    id: "registration",
    label: "Registration",
    count: registrations,
    unit: "users",
    available: true,
  };

  const userStages = [];
  let prevUser = null;
  for (const def of userStageDefs) {
    const stage = buildFunnelStage({
      ...def,
      previousStage: prevUser,
      registrationStage: registrationAnchor,
    });
    if (stage.available) {
      prevUser = stage;
    }
    userStages.push(stage);
  }

  const callStageDefs = [
    {
      id: "call_started",
      label: "Call Started",
      count: callStarted,
      unit: "calls",
      semantics: { subsetOfPrevious: false, subsetOfRegistration: false },
    },
    {
      id: "call_connected",
      label: "Call Connected",
      count: callConnected,
      unit: "calls",
      semantics: {
        subsetOfPrevious: true,
        subsetOfRegistration: false,
        populationDefinition:
          "Calls in period that connected (duration > 0 or connected status).",
      },
    },
    {
      id: "call_gt_30_sec",
      label: "Call > 30 Seconds",
      count: call30,
      unit: "calls",
      semantics: {
        subsetOfPrevious: true,
        subsetOfRegistration: false,
        populationDefinition: "Connected calls in period with duration >= 30 seconds.",
      },
    },
  ];

  const callStages = [];
  let prevCall = null;
  for (const def of callStageDefs) {
    const stage = buildFunnelStage({
      ...def,
      previousStage: prevCall,
      registrationStage: null,
    });
    callStages.push(stage);
    prevCall = stage;
  }

  const revenueStageDefs = [
    {
      id: "paying_users",
      label: "Paying Users",
      count: payments.payingUsers,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.paying_users,
    },
    {
      id: "first_time_payers",
      label: "First-Time Payers",
      count: payments.firstTimePayers,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.first_time_payers,
    },
    {
      id: "repeat_payers",
      label: "Repeat Payers",
      count: payments.repeatPayers,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.repeat_payers,
    },
    {
      id: "recharge_transactions",
      label: "Recharge Transactions",
      count: payments.transactionCount,
      unit: "transactions",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.recharge_transactions,
    },
  ];

  const revenueStages = [];
  let prevRevenue = null;
  for (const def of revenueStageDefs) {
    const stage = buildFunnelStage({
      ...def,
      previousStage: prevRevenue,
      registrationStage: registrationAnchor,
    });
    revenueStages.push(stage);
    if (stage.unit === "users") {
      prevRevenue = stage;
    } else {
      prevRevenue = null;
    }
  }

  return {
    userFunnel: {
      title: "ULOV User Growth Funnel",
      stages: userStages,
    },
    callFunnel: {
      title: "Call Event Funnel",
      note: "All stages are call counts. See Call Quality for the full call funnel.",
      stages: callStages,
    },
    revenueFunnel: {
      title: "Revenue Funnel",
      note: "User stages and transaction counts are not mixed into one conversion chain.",
      stages: revenueStages,
      grossRevenue: roundMoney(payments.grossRevenue),
    },
    stages: userStages,
    definitions: {
      firstTimePayer:
        "Users whose first-ever successful payment updatedAt falls within the selected IST period.",
      repeatPayer:
        "Users with 2+ lifetime successful payments who also made at least one payment in the selected period.",
      chatStarted:
        "Distinct users who sent at least one chat message in the period (not necessarily first-ever chat).",
    },
    note: "User, call, and revenue funnels use separate units. Conversions require the same unit and a true sequential subset population definition.",
  };
};

export {
  roundMoney,
  periodReplacements,
  buildFunnelStage,
  evaluateFunnelConversion,
};
