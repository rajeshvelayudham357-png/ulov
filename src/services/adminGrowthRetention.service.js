import { QueryTypes } from "sequelize";

import { GROWTH_ACTIVITY_DEFINITION } from "../constants/growthMetricDefinitions.js";
import { sequelize } from "../config/database.js";
import { addIstDays, toIstDateKey } from "./adminRevenueTime.service.js";
import { periodReplacements, safeRate } from "./adminGrowthMetrics.service.js";

const RETENTION_DAYS = [1, 3, 7, 14, 30];

const buildRetentionSelect = (dayOffset) => `
  SUM(
    CASE
      WHEN DATE(DATE_ADD(u.lastSeen, INTERVAL 330 MINUTE)) = DATE_ADD(cohort.cohortDate, INTERVAL ${dayOffset} DAY)
      THEN 1 ELSE 0
    END
  ) AS d${dayOffset}_active
`;

export const getRetentionCohorts = async (bounds) => {
  const replacements = periodReplacements(bounds);
  const todayKey = toIstDateKey(new Date());

  const selectParts = RETENTION_DAYS.map((day) => buildRetentionSelect(day)).join(
    ",\n"
  );

  const rows = await sequelize.query(
    `SELECT
       cohort.cohortDate,
       cohort.users,
       ${selectParts}
     FROM (
       SELECT
         DATE(DATE_ADD(u.createdAt, INTERVAL 330 MINUTE)) AS cohortDate,
         COUNT(*) AS users
       FROM users u
       WHERE u.createdAt >= :fromUtc AND u.createdAt <= :toUtc
       GROUP BY DATE(DATE_ADD(u.createdAt, INTERVAL 330 MINUTE))
     ) cohort
     INNER JOIN users u
       ON DATE(DATE_ADD(u.createdAt, INTERVAL 330 MINUTE)) = cohort.cohortDate
     GROUP BY cohort.cohortDate, cohort.users
     ORDER BY cohort.cohortDate ASC`,
    { replacements, type: QueryTypes.SELECT }
  );

  const cohorts = rows.map((row) => {
    const cohortDate =
      row.cohortDate instanceof Date
        ? row.cohortDate.toISOString().slice(0, 10)
        : String(row.cohortDate).slice(0, 10);
    const users = Number(row.users) || 0;

    const cohortAgeDays = Math.floor(
      (new Date(`${todayKey}T00:00:00+05:30`).getTime() -
        new Date(`${cohortDate}T00:00:00+05:30`).getTime()) /
        (24 * 60 * 60 * 1000)
    );

    const retention = {};

    for (const day of RETENTION_DAYS) {
      if (cohortAgeDays < day) {
        retention[`d${day}`] = {
          available: false,
          value: null,
          reason: `Cohort is only ${cohortAgeDays} days old.`,
        };
        continue;
      }

      const activeUsers = Number(row[`d${day}_active`]) || 0;
      retention[`d${day}`] = {
        available: true,
        value: safeRate(activeUsers, users),
        activeUsers,
      };
    }

    return {
      registrationDate: cohortDate,
      users,
      retention,
    };
  });

  return {
    activityDefinition: "lastSeen on IST calendar day +N after registration",
    cohorts,
  };
};

export const getUserActivityMetrics = async (bounds) => {
  const replacements = periodReplacements(bounds);
  const { toKey, fromUtc, toUtc } = bounds;

  const dauDateStart = new Date(`${toKey}T00:00:00+05:30`);
  const dauDateEnd = new Date(`${toKey}T23:59:59.999+05:30`);
  const wauStart = new Date(`${addIstDays(toKey, -6)}T00:00:00+05:30`);
  const mauStart = new Date(`${addIstDays(toKey, -29)}T00:00:00+05:30`);

  const [
    dauRow,
    wauRow,
    mauRow,
    newUsersRow,
    returningRow,
    trendRows,
  ] = await Promise.all([
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE lastSeen >= :dauStart AND lastSeen <= :dauEnd`,
      {
        replacements: { dauStart: dauDateStart, dauEnd: dauDateEnd },
        type: QueryTypes.SELECT,
      }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE lastSeen >= :wauStart AND lastSeen <= :toUtc`,
      { replacements: { wauStart, toUtc }, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE lastSeen >= :mauStart AND lastSeen <= :toUtc`,
      { replacements: { mauStart, toUtc }, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE createdAt < :fromUtc
         AND lastSeen >= :fromUtc AND lastSeen <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE createdAt < :fromUtc
         AND lastSeen >= :fromUtc AND lastSeen <= :toUtc`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT DATE(DATE_ADD(lastSeen, INTERVAL 330 MINUTE)) AS activityDate,
              COUNT(*) AS activeUsers
       FROM users
       WHERE lastSeen >= :fromUtc AND lastSeen <= :toUtc
       GROUP BY DATE(DATE_ADD(lastSeen, INTERVAL 330 MINUTE))
       ORDER BY activityDate ASC`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  const dau = Number(dauRow[0]?.count) || 0;
  const wau = Number(wauRow[0]?.count) || 0;
  const mau = Number(mauRow[0]?.count) || 0;
  const newUsers = Number(newUsersRow[0]?.count) || 0;
  const returningUsers = Number(returningRow[0]?.count) || 0;

  return {
    definitions: GROWTH_ACTIVITY_DEFINITION,
    dau,
    wau,
    mau,
    dauMauRatio: safeRate(dau, mau),
    newUsers,
    returningUsers,
    returningUserPct: safeRate(returningUsers, returningUsers + newUsers),
    reactivatedUsers: {
      available: false,
      value: null,
      label: "Not configured",
      reason:
        "Reactivation requires activity history beyond a single lastSeen timestamp.",
    },
    churnedUsers: {
      available: false,
      value: null,
      label: "Not configured",
      reason:
        "Churn requires a consistent inactivity definition beyond lastSeen gaps.",
    },
    trend: trendRows.map((row) => ({
      date:
        row.activityDate instanceof Date
          ? row.activityDate.toISOString().slice(0, 10)
          : String(row.activityDate).slice(0, 10),
      activeUsers: Number(row.activeUsers) || 0,
    })),
  };
};

export const getRetentionBundle = async (bounds) => {
  const [cohorts, activity] = await Promise.all([
    getRetentionCohorts(bounds),
    getUserActivityMetrics(bounds),
  ]);

  return { cohorts, activity };
};
