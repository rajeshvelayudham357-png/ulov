import { QueryTypes } from "sequelize";

import { GROWTH_EVENT_NAMES } from "../constants/growthEventDefinitions.js";
import { sequelize } from "../config/database.js";
import { unavailableMetric, periodReplacements } from "./adminGrowthMetrics.service.js";
import {
  countGrowthEvents,
  hasGrowthEventsEver,
} from "./growthEvents.service.js";
import { ensureGrowthEventSchema } from "./growthEventSchema.service.js";

const availableMetric = (value, label = null) => ({
  available: true,
  value: Number(value) || 0,
  label: label ?? String(value),
});

const buildEventMetric = async (eventName, bounds, options = {}) => {
  const { distinctUser = false, distinctAnonymous = false, unavailableReason = "Not tracked" } =
    options;

  if (eventName === GROWTH_EVENT_NAMES.AD_IMPRESSION) {
    return {
      available: false,
      value: null,
      label: "Not configured",
      reason: "Ad integration not connected",
    };
  }

  const everTracked = await hasGrowthEventsEver(eventName);
  if (!everTracked) {
    return unavailableMetric(unavailableReason, unavailableReason);
  }

  const count = await countGrowthEvents(bounds, {
    eventName,
    distinctUser,
    distinctAnonymous,
  });

  return availableMetric(count);
};

const breakdownQuery = async (bounds, column) => {
  await ensureGrowthEventSchema();

  const allowed = new Set([
    "source",
    "medium",
    "campaign",
    "referralCode",
  ]);
  if (!allowed.has(column)) {
    return [];
  }

  const rows = await sequelize.query(
    `SELECT COALESCE(${column}, '(none)') AS label, COUNT(*) AS count
     FROM growth_events
     WHERE createdAt >= :fromUtc AND createdAt <= :toUtc
       AND ${column} IS NOT NULL AND ${column} <> ''
     GROUP BY ${column}
     ORDER BY count DESC
     LIMIT 25`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );

  return rows.map((row) => ({
    label: row.label,
    count: Number(row.count) || 0,
  }));
};

export const getAcquisitionAnalytics = async (bounds) => {
  await ensureGrowthEventSchema();

  const replacements = periodReplacements(bounds);

  const [registrationRow, profileRow] = await Promise.all([
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
  ]);

  const [
    impressions,
    storeVisits,
    installs,
    creatorViews,
    sourceBreakdown,
    mediumBreakdown,
    campaignBreakdown,
    referralBreakdown,
  ] = await Promise.all([
    buildEventMetric(GROWTH_EVENT_NAMES.AD_IMPRESSION, bounds),
    buildEventMetric(GROWTH_EVENT_NAMES.STORE_VISIT, bounds),
    buildEventMetric(GROWTH_EVENT_NAMES.APP_INSTALL, bounds, {
      distinctAnonymous: true,
    }),
    buildEventMetric(GROWTH_EVENT_NAMES.CREATOR_PROFILE_VIEWED, bounds, {
      distinctUser: true,
    }),
    breakdownQuery(bounds, "source"),
    breakdownQuery(bounds, "medium"),
    breakdownQuery(bounds, "campaign"),
    breakdownQuery(bounds, "referralCode"),
  ]);

  const registrations = availableMetric(registrationRow[0]?.count || 0);
  const profileCompleted = availableMetric(profileRow[0]?.count || 0);

  const hasAttribution =
    (await hasGrowthEventsEver(GROWTH_EVENT_NAMES.APP_INSTALL)) ||
    (await hasGrowthEventsEver(GROWTH_EVENT_NAMES.STORE_VISIT)) ||
    (await hasGrowthEventsEver(GROWTH_EVENT_NAMES.REGISTRATION_COMPLETED));

  return {
    impressions,
    storeVisits,
    installs,
    registrations,
    profileCompleted,
    creatorViews,
    sourceBreakdown: hasAttribution
      ? { available: true, rows: sourceBreakdown }
      : { available: false, reason: "Not tracked", rows: [] },
    mediumBreakdown: hasAttribution
      ? { available: true, rows: mediumBreakdown }
      : { available: false, reason: "Not tracked", rows: [] },
    campaignBreakdown: hasAttribution
      ? { available: true, rows: campaignBreakdown }
      : { available: false, reason: "Not tracked", rows: [] },
    referralBreakdown: hasAttribution
      ? { available: true, rows: referralBreakdown }
      : { available: false, reason: "Not tracked", rows: [] },
    googleAds: {
      available: false,
      reason: "Google Ads integration not connected",
    },
  };
};

/** Merge real event metrics into legacy acquisition placeholder shape for monetization/insights. */
export const getAcquisitionDashboardPayload = async (bounds) => {
  const analytics = await getAcquisitionAnalytics(bounds);

  return {
    available: analytics.installs.available || analytics.storeVisits.available,
    label: "Growth event tracking",
    metrics: {
      spend: unavailableMetric("Not configured", "Google Ads not connected"),
      impressions: analytics.impressions,
      clicks: unavailableMetric("Not tracked"),
      ctr: unavailableMetric("Not tracked"),
      cpc: unavailableMetric("Not configured", "Google Ads not connected"),
      installs: analytics.installs,
      cpi: unavailableMetric("Not configured", "Google Ads not connected"),
      registrations: analytics.registrations,
      costPerRegistration: unavailableMetric(
        "Not configured",
        "Google Ads not connected"
      ),
      firstCalls: unavailableMetric("Not tracked"),
      firstPayers: unavailableMetric("Not tracked"),
      costPerPayer: unavailableMetric("Not configured", "Google Ads not connected"),
      attributedRevenue: unavailableMetric("Not tracked"),
      roas: unavailableMetric("Not configured", "Google Ads not connected"),
    },
    channels: {
      available: analytics.sourceBreakdown.available,
      reason: analytics.sourceBreakdown.available
        ? null
        : analytics.sourceBreakdown.reason,
      sources: analytics.sourceBreakdown.available
        ? analytics.sourceBreakdown.rows.map((row) => ({
            source: row.label,
            available: true,
            count: row.count,
          }))
        : ["Google Ads", "Organic", "Referral", "Direct", "Social", "Other"].map(
            (source) => ({
              source,
              available: false,
              reason: "Attribution not tracked",
            })
          ),
    },
    breakdown: analytics,
  };
};
