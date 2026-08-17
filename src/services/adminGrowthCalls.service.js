import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  CALL_ACCEPTED_SQL,
  CALL_CONNECTED_SQL,
  CALL_FAILED_SQL,
  periodReplacements,
  safeRate,
} from "./adminGrowthMetrics.service.js";
import { getGrowthThresholds } from "./adminGrowthThresholds.service.js";

const durationBucketSql = `
  SUM(CASE WHEN COALESCE(duration, 0) < 5 THEN 1 ELSE 0 END) AS bucket_0_5,
  SUM(CASE WHEN duration >= 5 AND duration < 15 THEN 1 ELSE 0 END) AS bucket_5_15,
  SUM(CASE WHEN duration >= 15 AND duration < 30 THEN 1 ELSE 0 END) AS bucket_15_30,
  SUM(CASE WHEN duration >= 30 AND duration < 60 THEN 1 ELSE 0 END) AS bucket_30_60,
  SUM(CASE WHEN duration >= 60 AND duration < 300 THEN 1 ELSE 0 END) AS bucket_1_5min,
  SUM(CASE WHEN duration >= 300 AND duration < 600 THEN 1 ELSE 0 END) AS bucket_5_10min,
  SUM(CASE WHEN duration >= 600 THEN 1 ELSE 0 END) AS bucket_10plus
`;

export const getCallQualityMetrics = async (bounds) => {
  const replacements = periodReplacements(bounds);

  const [metricsRow] = await sequelize.query(
    `SELECT
       COUNT(*) AS totalCalls,
       SUM(CASE WHEN ${CALL_ACCEPTED_SQL} THEN 1 ELSE 0 END) AS acceptedCalls,
       SUM(CASE WHEN ${CALL_CONNECTED_SQL} THEN 1 ELSE 0 END) AS connectedCalls,
       SUM(CASE WHEN COALESCE(duration, 0) >= 5 THEN 1 ELSE 0 END) AS callsGt5Sec,
       SUM(CASE WHEN COALESCE(duration, 0) >= 30 THEN 1 ELSE 0 END) AS callsGt30Sec,
       SUM(CASE WHEN COALESCE(duration, 0) >= 60 THEN 1 ELSE 0 END) AS callsGt60Sec,
       SUM(CASE WHEN COALESCE(duration, 0) >= 300 THEN 1 ELSE 0 END) AS callsGt5Min,
       AVG(COALESCE(duration, 0)) AS avgDuration,
       SUM(CASE WHEN ${CALL_FAILED_SQL} THEN 1 ELSE 0 END) AS failedCalls,
       SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) AS missedCalls,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedCalls,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledCalls
     FROM call_histories
     WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
    { replacements, type: QueryTypes.SELECT }
  );

  const connected = Number(metricsRow?.connectedCalls) || 0;
  const total = Number(metricsRow?.totalCalls) || 0;
  const callsGt30 = Number(metricsRow?.callsGt30Sec) || 0;
  const avgDuration = Number(metricsRow?.avgDuration) || 0;

  const [medianRow] = await sequelize.query(
    `SELECT AVG(duration) AS medianDuration
     FROM (
       SELECT duration,
              ROW_NUMBER() OVER (ORDER BY duration) AS rowNum,
              COUNT(*) OVER () AS totalRows
       FROM call_histories
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc
         AND ${CALL_CONNECTED_SQL}
     ) ranked
     WHERE rowNum IN (FLOOR((totalRows + 1) / 2), CEIL((totalRows + 1) / 2))`,
    { replacements, type: QueryTypes.SELECT }
  );

  const [creatorAnswerRow] = await sequelize.query(
    `SELECT
       COUNT(*) AS received,
       SUM(CASE WHEN ${CALL_ACCEPTED_SQL} THEN 1 ELSE 0 END) AS answered
     FROM call_histories ch
     INNER JOIN users u ON u.id = ch.receiverId
     WHERE u.gender IN ('Female', 'female')
       AND ch.createdAt >= :fromUtc AND ch.createdAt <= :toUtc`,
    { replacements, type: QueryTypes.SELECT }
  );

  const received = Number(creatorAnswerRow?.received) || 0;
  const answered = Number(creatorAnswerRow?.answered) || 0;

  const thresholds = await getGrowthThresholds();
  const callSuccessRate = safeRate(callsGt30, connected);
  const creatorAnswerRate = safeRate(answered, received);
  const failedRate = safeRate(Number(metricsRow?.failedCalls) || 0, total);
  const connectedGt30Rate = safeRate(callsGt30, connected);

  const warnings = [];
  if (connected > 0 && avgDuration < thresholds.minAvgCallDurationSec) {
    warnings.push({
      code: "LOW_CALL_ENGAGEMENT",
      severity: "warning",
      message: "Call engagement is low",
      detail: `Average call duration is ${Math.round(avgDuration)}s (threshold: ${thresholds.minAvgCallDurationSec}s).`,
    });
  }

  if (connected > 0) {
    warnings.push({
      code: "CONNECTED_CALL_QUALITY",
      severity:
        connectedGt30Rate !== null &&
        connectedGt30Rate < thresholds.minCallSuccessRatePct
          ? "warning"
          : "info",
      message: `Only ${connectedGt30Rate ?? 0}% of connected calls lasted more than 30 seconds.`,
    });
  }

  return {
    metrics: {
      totalCalls: total,
      acceptedCalls: Number(metricsRow?.acceptedCalls) || 0,
      connectedCalls: connected,
      callsGt5Sec: Number(metricsRow?.callsGt5Sec) || 0,
      callsGt30Sec: callsGt30,
      callsGt60Sec: Number(metricsRow?.callsGt60Sec) || 0,
      callsGt5Min: Number(metricsRow?.callsGt5Min) || 0,
      avgDurationSeconds: Math.round(avgDuration),
      medianDurationSeconds: Math.round(
        Number(medianRow?.medianDuration) || 0
      ),
      callSuccessRate,
      creatorAnswerRate,
      failedCallRate: failedRate,
      callerHangupRate: {
        available: false,
        value: null,
        label: "Not tracked",
        reason: "Hangup initiator is not stored on call_histories.",
      },
      creatorHangupRate: {
        available: false,
        value: null,
        label: "Not tracked",
        reason: "Hangup initiator is not stored on call_histories.",
      },
      inferredMissedRate: safeRate(
        Number(metricsRow?.missedCalls) || 0,
        total
      ),
      inferredRejectedRate: safeRate(
        Number(metricsRow?.rejectedCalls) || 0,
        total
      ),
      inferredCancelledRate: safeRate(
        Number(metricsRow?.cancelledCalls) || 0,
        total
      ),
    },
    warnings,
    definitions: {
      callSuccessRate:
        "Calls >= 30 seconds / connected calls. Not completed/total.",
      creatorAnswerRate:
        "Answered incoming creator calls / total incoming creator calls.",
    },
  };
};

export const getCallFunnel = async (bounds) => {
  const quality = await getCallQualityMetrics(bounds);
  const m = quality.metrics;

  const stages = [
    { id: "started", label: "Call Started", count: m.totalCalls },
    { id: "accepted", label: "Accepted", count: m.acceptedCalls },
    { id: "connected", label: "Connected", count: m.connectedCalls },
    { id: "gt_30", label: "30 Seconds", count: m.callsGt30Sec },
    { id: "gt_60", label: "60 Seconds", count: m.callsGt60Sec },
    { id: "gt_5min", label: "5 Minutes", count: m.callsGt5Min },
  ];

  let previous = null;
  return {
    stages: stages.map((stage) => {
      const item = {
        ...stage,
        conversionFromPrevious:
          previous !== null ? safeRate(stage.count, previous) : null,
      };
      previous = stage.count;
      return item;
    }),
  };
};

export const getDurationDistribution = async (bounds) => {
  const replacements = periodReplacements(bounds);

  const [row] = await sequelize.query(
    `SELECT
       COUNT(*) AS total,
       ${durationBucketSql}
     FROM call_histories
     WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
    { replacements, type: QueryTypes.SELECT }
  );

  const total = Number(row?.total) || 0;
  const buckets = [
    { label: "0–5 sec", key: "bucket_0_5" },
    { label: "5–15 sec", key: "bucket_5_15" },
    { label: "15–30 sec", key: "bucket_15_30" },
    { label: "30–60 sec", key: "bucket_30_60" },
    { label: "1–5 min", key: "bucket_1_5min" },
    { label: "5–10 min", key: "bucket_5_10min" },
    { label: "10+ min", key: "bucket_10plus" },
  ].map(({ label, key }) => {
    const count = Number(row?.[key]) || 0;
    return {
      label,
      count,
      percentage: safeRate(count, total),
    };
  });

  return { total, buckets };
};

export const getCallAnalyticsBundle = async (bounds) => {
  const [quality, funnel, distribution] = await Promise.all([
    getCallQualityMetrics(bounds),
    getCallFunnel(bounds),
    getDurationDistribution(bounds),
  ]);

  return {
    quality,
    funnel,
    distribution,
  };
};
