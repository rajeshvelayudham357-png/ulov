import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { SUCCESSFUL_PAYMENT_STATUSES, safeRate, unavailableMetric } from "./adminGrowthMetrics.service.js";
import { periodReplacements } from "./adminGrowthMetrics.service.js";
import { ensureGrowthEventSchema } from "./growthEventSchema.service.js";
import { hasGrowthEventsEver } from "./growthEvents.service.js";

const channelLabel = (row) => {
  const source = row.firstTouchSource || row.lastTouchSource || "(none)";
  const medium = row.firstTouchMedium || row.lastTouchMedium || "(none)";
  return `${source} / ${medium}`;
};

export const getAttributionAnalytics = async (bounds) => {
  await ensureGrowthEventSchema();

  const hasData = await hasGrowthEventsEver("REGISTRATION_COMPLETED");
  const hasAttributionTable = await sequelize.query(
    `SELECT COUNT(*) AS count FROM user_attribution LIMIT 1`,
    { type: QueryTypes.SELECT }
  );
  const attributionRows = Number(hasAttributionTable[0]?.count) || 0;

  if (!hasData && attributionRows === 0) {
    return {
      available: false,
      reason: "Not tracked",
      rows: [],
      summary: {
        installs: unavailableMetric("Not tracked"),
        registrations: unavailableMetric("Not tracked"),
        payingUsers: unavailableMetric("Not tracked"),
        firstTimePayers: unavailableMetric("Not tracked"),
        revenue: unavailableMetric("Not tracked"),
      },
    };
  }

  const replacements = {
    ...periodReplacements(bounds),
    paymentStatuses: SUCCESSFUL_PAYMENT_STATUSES,
  };

  const rows = await sequelize.query(
    `SELECT
       COALESCE(ua.firstTouchSource, '(none)') AS source,
       COALESCE(ua.firstTouchMedium, '(none)') AS medium,
       COALESCE(ua.firstTouchCampaign, '(none)') AS campaign,
       ua.firstTouchSource,
       ua.firstTouchMedium,
       ua.firstTouchCampaign,
       ua.lastTouchSource,
       ua.lastTouchMedium,
       COUNT(DISTINCT CASE
         WHEN ge_install.id IS NOT NULL THEN COALESCE(ua.userId, ua.anonymousId)
       END) AS installs,
       COUNT(DISTINCT CASE
         WHEN u.id IS NOT NULL AND u.createdAt >= :fromUtc AND u.createdAt <= :toUtc THEN u.id
       END) AS registrations,
       COUNT(DISTINCT CASE
         WHEN po.id IS NOT NULL THEN po.userId
       END) AS payingUsers,
       COUNT(DISTINCT CASE
         WHEN fp.firstPaidAt >= :fromUtc AND fp.firstPaidAt <= :toUtc THEN fp.userId
       END) AS firstTimePayers,
       COALESCE(SUM(CASE
         WHEN po.id IS NOT NULL THEN po.amount ELSE 0
       END), 0) AS revenue
     FROM user_attribution ua
     LEFT JOIN users u ON u.id = ua.userId
     LEFT JOIN growth_events ge_install
       ON ge_install.eventName = 'APP_INSTALL'
       AND (
         ge_install.anonymousId = ua.anonymousId
         OR ge_install.userId = ua.userId
       )
       AND ge_install.createdAt >= :fromUtc AND ge_install.createdAt <= :toUtc
     LEFT JOIN payment_orders po
       ON po.userId = ua.userId
       AND po.status IN (:paymentStatuses)
       AND po.updatedAt >= :fromUtc AND po.updatedAt <= :toUtc
     LEFT JOIN (
       SELECT po2.userId, MIN(po2.updatedAt) AS firstPaidAt
       FROM payment_orders po2
       WHERE po2.status IN (:paymentStatuses)
       GROUP BY po2.userId
     ) fp ON fp.userId = ua.userId
     GROUP BY
       ua.firstTouchSource,
       ua.firstTouchMedium,
       ua.firstTouchCampaign,
       ua.lastTouchSource,
       ua.lastTouchMedium
     ORDER BY registrations DESC, installs DESC
     LIMIT 50`,
    { replacements, type: QueryTypes.SELECT }
  );

  const formatted = rows.map((row) => {
    const installs = Number(row.installs) || 0;
    const registrations = Number(row.registrations) || 0;
    const payingUsers = Number(row.payingUsers) || 0;
    const firstTimePayers = Number(row.firstTimePayers) || 0;
    const revenue = Number(row.revenue) || 0;

    return {
      channel: channelLabel(row),
      source: row.source,
      medium: row.medium,
      campaign: row.campaign,
      installs,
      registrations,
      payingUsers,
      firstTimePayers,
      revenue,
      installToRegistrationRate:
        installs > 0 && registrations <= installs
          ? safeRate(registrations, installs)
          : null,
      registrationToPayerRate:
        registrations > 0 && firstTimePayers <= registrations
          ? safeRate(firstTimePayers, registrations)
          : null,
      conversionComparable:
        installs > 0
          ? registrations <= installs
          : registrations > 0
            ? firstTimePayers <= registrations
            : false,
    };
  });

  const totals = formatted.reduce(
    (acc, row) => {
      acc.installs += row.installs;
      acc.registrations += row.registrations;
      acc.payingUsers += row.payingUsers;
      acc.firstTimePayers += row.firstTimePayers;
      acc.revenue += row.revenue;
      return acc;
    },
    {
      installs: 0,
      registrations: 0,
      payingUsers: 0,
      firstTimePayers: 0,
      revenue: 0,
    }
  );

  return {
    available: true,
    reason: null,
    rows: formatted,
    summary: {
      installs: { available: true, value: totals.installs },
      registrations: { available: true, value: totals.registrations },
      payingUsers: { available: true, value: totals.payingUsers },
      firstTimePayers: { available: true, value: totals.firstTimePayers },
      revenue: { available: true, value: totals.revenue },
      installToRegistrationRate:
        totals.installs > 0 && totals.registrations <= totals.installs
          ? safeRate(totals.registrations, totals.installs)
          : null,
      registrationToPayerRate:
        totals.registrations > 0 && totals.firstTimePayers <= totals.registrations
          ? safeRate(totals.firstTimePayers, totals.registrations)
          : null,
    },
  };
};
