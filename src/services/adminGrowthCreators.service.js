import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { istHourSql } from "./adminRevenueTime.service.js";
import {
  CALL_ACCEPTED_SQL,
  CALL_CONNECTED_SQL,
  periodReplacements,
  safeRate,
} from "./adminGrowthMetrics.service.js";

const getDisplayName = (row) =>
  row.nickname ||
  (row.name && row.name !== "New User" ? row.name : null) ||
  row.username ||
  row.publicUserId ||
  `Creator ${row.id}`;

export const getCreatorAvailabilitySummary = async (bounds) => {
  const replacements = periodReplacements(bounds);

  const [summaryRow] = await sequelize.query(
    `SELECT
       SUM(CASE WHEN u.gender IN ('Female','female') AND u.accountStatus = 'approved' THEN 1 ELSE 0 END) AS approvedCreators,
       SUM(CASE WHEN u.gender IN ('Female','female') AND u.accountStatus = 'approved' AND u.lastSeen >= :fromUtc AND u.lastSeen <= :toUtc THEN 1 ELSE 0 END) AS activeCreators,
       SUM(CASE WHEN u.gender IN ('Female','female') AND u.accountStatus = 'approved' AND u.online = 1 THEN 1 ELSE 0 END) AS onlineCreatorsNow,
       SUM(CASE WHEN u.gender IN ('Female','female') AND u.accountStatus = 'approved' AND u.lastSeen >= :fromUtc AND u.lastSeen <= :toUtc THEN 1 ELSE 0 END) AS creatorsOnlineInPeriod
     FROM users u`,
    { replacements, type: QueryTypes.SELECT }
  );

  const [onlineMinutesRow] = await sequelize.query(
    `SELECT
       COALESCE(AVG(fda.onlineMinutes), 0) AS avgOnlineMinutes,
       COALESCE(SUM(fda.onlineMinutes), 0) AS totalOnlineMinutes
     FROM female_daily_activity fda
     WHERE fda.activityDate >= DATE(:fromUtc + INTERVAL 330 MINUTE)
       AND fda.activityDate <= DATE(:toUtc + INTERVAL 330 MINUTE)`,
    { replacements, type: QueryTypes.SELECT }
  );

  const [callStatsRow] = await sequelize.query(
    `SELECT
       COUNT(*) AS callsReceived,
       SUM(CASE WHEN ${CALL_ACCEPTED_SQL} THEN 1 ELSE 0 END) AS callsAnswered
     FROM call_histories ch
     INNER JOIN users u ON u.id = ch.receiverId
     WHERE u.gender IN ('Female','female')
       AND ch.createdAt >= :fromUtc AND ch.createdAt <= :toUtc`,
    { replacements, type: QueryTypes.SELECT }
  );

  const approved = Number(summaryRow?.approvedCreators) || 0;
  const received = Number(callStatsRow?.callsReceived) || 0;
  const answered = Number(callStatsRow?.callsAnswered) || 0;

  return {
    approvedCreators: approved,
    activeCreators: Number(summaryRow?.activeCreators) || 0,
    onlineCreatorsNow: Number(summaryRow?.onlineCreatorsNow) || 0,
    creatorsOnlineInPeriod: Number(summaryRow?.creatorsOnlineInPeriod) || 0,
    averageOnlineHours:
      Number(onlineMinutesRow?.avgOnlineMinutes) > 0
        ? Number(
            (
              Number(onlineMinutesRow.avgOnlineMinutes) / 60
            ).toFixed(1)
          )
        : 0,
    totalOnlineHours: Number(
      ((Number(onlineMinutesRow?.totalOnlineMinutes) || 0) / 60).toFixed(1)
    ),
    creatorAnswerRate: safeRate(answered, received),
    averageCreatorResponseTime: {
      available: false,
      value: null,
      label: "Not tracked",
      reason: "Time-to-accept is not stored on call_histories.",
    },
    callsReceivedPerCreator:
      approved > 0 ? Number((received / approved).toFixed(1)) : 0,
    callsAnsweredPerCreator:
      approved > 0 ? Number((answered / approved).toFixed(1)) : 0,
    dataSources: [
      "users.online / users.lastSeen",
      "female_daily_activity.onlineMinutes",
      "call_histories (incoming to female receivers)",
    ],
  };
};

export const getCreatorAvailabilityByHour = async (bounds) => {
  const replacements = periodReplacements(bounds);
  const hourExpr = istHourSql("ch.createdAt");
  const onlineHourExpr = istHourSql("uol.cameOnlineAt");

  const [callHours, onlineHours, unansweredHours] = await Promise.all([
    sequelize.query(
      `SELECT ${hourExpr} AS hour, COUNT(*) AS calls
       FROM call_histories ch
       WHERE ch.createdAt >= :fromUtc AND ch.createdAt <= :toUtc
       GROUP BY ${hourExpr}
       ORDER BY hour ASC`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT ${onlineHourExpr} AS hour, COUNT(DISTINCT uol.userId) AS onlineCreators
       FROM user_online_logs uol
       INNER JOIN users u ON u.id = uol.userId
       WHERE u.gender IN ('Female','female')
         AND uol.cameOnlineAt >= :fromUtc AND uol.cameOnlineAt <= :toUtc
       GROUP BY ${onlineHourExpr}
       ORDER BY hour ASC`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT ${hourExpr} AS hour, COUNT(*) AS unanswered
       FROM call_histories ch
       WHERE ch.createdAt >= :fromUtc AND ch.createdAt <= :toUtc
         AND ch.status IN ('missed','rejected')
       GROUP BY ${hourExpr}
       ORDER BY hour ASC`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  const byHour = Array.from({ length: 24 }, (_, hour) => {
    const callMatch = callHours.find((row) => Number(row.hour) === hour);
    const onlineMatch = onlineHours.find((row) => Number(row.hour) === hour);
    const unansweredMatch = unansweredHours.find(
      (row) => Number(row.hour) === hour
    );

    return {
      hour: `${String(hour).padStart(2, "0")}:00`,
      onlineCreators: Number(onlineMatch?.onlineCreators) || 0,
      calls: Number(callMatch?.calls) || 0,
      unansweredCalls: Number(unansweredMatch?.unanswered) || 0,
    };
  });

  const peakDemand = [...byHour].sort((a, b) => b.calls - a.calls)[0];
  const lowCoverage = [...byHour]
    .filter((row) => row.calls >= 5 && row.onlineCreators <= 1)
    .slice(0, 3);

  return {
    hours: byHour,
    recommendation:
      lowCoverage.length > 0
        ? `${lowCoverage[0].hour} has high caller demand (${lowCoverage[0].calls} calls) but low creator availability (${lowCoverage[0].onlineCreators} online).`
        : peakDemand?.calls > 0
          ? `Peak call demand at ${peakDemand.hour} (${peakDemand.calls} calls).`
          : null,
    note: "Online creators by hour uses user_online_logs (female creators only). Historical online state beyond logs is not available.",
  };
};

export const getCreatorLeaderboard = async (bounds, { sortBy = "earnings" } = {}) => {
  const replacements = periodReplacements(bounds);

  const rows = await sequelize.query(
    `SELECT
       u.id AS creatorId,
       u.publicUserId,
       u.nickname,
       u.name,
       u.username,
       COALESCE(SUM(fda.onlineMinutes), 0) AS onlineMinutes,
       COUNT(ch.id) AS callsReceived,
       SUM(CASE WHEN ${CALL_ACCEPTED_SQL} THEN 1 ELSE 0 END) AS callsAnswered,
       SUM(CASE WHEN ch.status IN ('completed','ended') OR (COALESCE(ch.duration,0) > 0 AND ch.status NOT IN ('missed','rejected','cancelled')) THEN 1 ELSE 0 END) AS completedCalls,
       SUM(CASE WHEN COALESCE(ch.duration, 0) >= 30 THEN 1 ELSE 0 END) AS callsGt30Sec,
       AVG(CASE WHEN ${CALL_CONNECTED_SQL} THEN COALESCE(ch.duration, 0) END) AS avgDuration,
       COALESCE(SUM(e.amount), 0) AS earnings,
       COALESCE(AVG(
         CASE cr.rating
           WHEN 'very_bad' THEN 1
           WHEN 'bad' THEN 2
           WHEN 'average' THEN 3
           WHEN 'good' THEN 4
           WHEN 'very_good' THEN 5
           ELSE NULL
         END
       ), 0) AS avgRating,
       COUNT(DISTINCT ch.callerId) AS uniqueCallers,
       COUNT(DISTINCT CASE WHEN repeat_callers.callerId IS NOT NULL THEN ch.callerId END) AS repeatCallers
     FROM users u
     LEFT JOIN call_histories ch
       ON ch.receiverId = u.id
      AND ch.createdAt >= :fromUtc
      AND ch.createdAt <= :toUtc
     LEFT JOIN earnings e
       ON e.userId = u.id
      AND e.createdAt >= :fromUtc
      AND e.createdAt <= :toUtc
     LEFT JOIN call_ratings cr
       ON cr.femaleId = u.id
      AND cr.createdAt >= :fromUtc
      AND cr.createdAt <= :toUtc
     LEFT JOIN female_daily_activity fda
       ON fda.userId = u.id
      AND fda.activityDate >= DATE(:fromUtc + INTERVAL 330 MINUTE)
      AND fda.activityDate <= DATE(:toUtc + INTERVAL 330 MINUTE)
     LEFT JOIN (
       SELECT receiverId, callerId
       FROM call_histories
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc
       GROUP BY receiverId, callerId
       HAVING COUNT(*) >= 2
     ) repeat_callers
       ON repeat_callers.receiverId = u.id
      AND repeat_callers.callerId = ch.callerId
     WHERE u.gender IN ('Female','female')
       AND u.accountStatus = 'approved'
     GROUP BY u.id, u.publicUserId, u.nickname, u.name, u.username
     HAVING callsReceived > 0 OR earnings > 0 OR onlineMinutes > 0`,
    { replacements, type: QueryTypes.SELECT }
  );

  const creators = rows.map((row) => {
    const callsReceived = Number(row.callsReceived) || 0;
    const callsAnswered = Number(row.callsAnswered) || 0;

    return {
      creatorId: row.creatorId,
      publicUserId: row.publicUserId || null,
      displayName: getDisplayName(row),
      onlineHours: Number(
        ((Number(row.onlineMinutes) || 0) / 60).toFixed(1)
      ),
      callsReceived,
      callsAnswered,
      answerRate: safeRate(callsAnswered, callsReceived),
      completedCalls: Number(row.completedCalls) || 0,
      callsGt30Sec: Number(row.callsGt30Sec) || 0,
      avgCallDurationSeconds: Math.round(Number(row.avgDuration) || 0),
      earnings: Number(Number(row.earnings || 0).toFixed(2)),
      rating: Number(Number(row.avgRating || 0).toFixed(2)),
      repeatCallers: Number(row.repeatCallers) || 0,
    };
  });

  const sortKeyMap = {
    earnings: (a, b) => b.earnings - a.earnings,
    calls: (a, b) => b.callsReceived - a.callsReceived,
    answerRate: (a, b) => (b.answerRate || 0) - (a.answerRate || 0),
    duration: (a, b) => b.avgCallDurationSeconds - a.avgCallDurationSeconds,
    rating: (a, b) => b.rating - a.rating,
    onlineHours: (a, b) => b.onlineHours - a.onlineHours,
  };

  creators.sort(sortKeyMap[sortBy] || sortKeyMap.earnings);

  const top5 = creators.slice(0, 5);

  const highDemandLowAvailability = creators
    .filter(
      (c) => c.callsReceived >= 10 && c.answerRate !== null && c.answerRate < 60
    )
    .slice(0, 5);

  const highTrafficLowConversion = creators
    .filter(
      (c) =>
        c.callsReceived >= 10 &&
        c.callsGt30Sec > 0 &&
        safeRate(c.callsGt30Sec, c.callsReceived) !== null &&
        safeRate(c.callsGt30Sec, c.callsReceived) < 30
    )
    .slice(0, 5);

  return {
    sortBy,
    total: creators.length,
    top5,
    leaderboard: creators,
    segments: {
      highDemandLowAvailability,
      highTrafficLowConversion,
      highEarnings: creators.filter((c) => c.earnings > 0).slice(0, 5),
      lowPerforming: creators
        .filter(
          (c) =>
            c.callsReceived >= 5 &&
            (c.answerRate === null || c.answerRate < 50)
        )
        .slice(-5)
        .reverse(),
    },
  };
};

export const getCreatorAnalyticsBundle = async (bounds, options = {}) => {
  const [summary, byHour, leaderboard] = await Promise.all([
    getCreatorAvailabilitySummary(bounds),
    getCreatorAvailabilityByHour(bounds),
    getCreatorLeaderboard(bounds, options),
  ]);

  return { summary, byHour, leaderboard };
};
