import {
  buildPeriodMeta,
  validateGrowthDateRange,
} from "../services/adminGrowthTime.service.js";
import {
  getExecutiveSummary,
  getGrowthFunnel,
} from "../services/adminGrowthMetrics.service.js";
import {
  getCallAnalyticsBundle,
  getCallQualityMetrics,
} from "../services/adminGrowthCalls.service.js";
import { getCreatorAnalyticsBundle } from "../services/adminGrowthCreators.service.js";
import { getMonetizationBundle } from "../services/adminGrowthMonetization.service.js";
import { getRevenueBundle } from "../services/adminGrowthRevenue.service.js";
import {
  getAcquisitionAnalytics,
  getAcquisitionDashboardPayload,
} from "../services/adminGrowthAcquisition.service.js";
import { getAttributionAnalytics } from "../services/adminGrowthAttribution.service.js";
import { getRetentionBundle } from "../services/adminGrowthRetention.service.js";
import { getLiveHealthStatus } from "../services/adminGrowthHealth.service.js";
import { getInsightsBundle } from "../services/adminGrowthInsights.service.js";
import { getCallDeliveryDiagnostics } from "../services/callDelivery.service.js";
import { ensureGrowthAnalyticsIndexes } from "../services/adminGrowthSchema.service.js";
import { GROWTH_METRIC_DEFINITIONS } from "../constants/growthMetricDefinitions.js";

const parseGrowthRequest = (req) => {
  const period = String(req.query.period || "7d").trim();
  const from = String(req.query.from || req.query.startDate || "").trim();
  const to = String(req.query.to || req.query.endDate || "").trim();

  const validation = validateGrowthDateRange({
    period,
    customFrom: from,
    customTo: to,
  });

  if (!validation.valid) {
    const error = new Error(validation.message);
    error.statusCode = 400;
    throw error;
  }

  return {
    current: validation.current,
    previous: validation.previous,
    meta: buildPeriodMeta(validation),
  };
};

const handleGrowthError = (res, error, label) => {
  console.log(`${label} ERROR`, error);
  return res.status(error.statusCode || 500).json({
    message: error.message || "Growth analytics request failed",
  });
};

export const getGrowthBootstrap = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);

    const [summary, health, funnel, callQuality, callDeliveryDiagnostics] =
      await Promise.all([
      getExecutiveSummary(context),
      getLiveHealthStatus(),
      getGrowthFunnel(context.current),
      getCallQualityMetrics(context.current),
      getCallDeliveryDiagnostics(context.current),
    ]);

    return res.json({
      ...context.meta,
      metricDefinitions: GROWTH_METRIC_DEFINITIONS,
      summary,
      health,
      funnel,
      callQuality,
      callDeliveryDiagnostics,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH BOOTSTRAP");
  }
};

export const getGrowthCalls = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const data = await getCallAnalyticsBundle(context.current);

    return res.json({
      ...context.meta,
      ...data,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH CALLS");
  }
};

export const getGrowthCreators = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const sortBy = String(req.query.sortBy || "earnings").trim();
    const data = await getCreatorAnalyticsBundle(context.current, { sortBy });

    return res.json({
      ...context.meta,
      ...data,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH CREATORS");
  }
};

export const getGrowthMonetization = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const data = await getMonetizationBundle(context.current);
    const acquisition = await getAcquisitionDashboardPayload(context.current);

    return res.json({
      ...context.meta,
      ...data,
      acquisition,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH MONETIZATION");
  }
};

export const getGrowthRevenue = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const data = await getRevenueBundle(context.current);

    return res.json({
      ...context.meta,
      ...data,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH REVENUE");
  }
};

export const getGrowthRetention = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const data = await getRetentionBundle(context.current);

    return res.json({
      ...context.meta,
      ...data,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH RETENTION");
  }
};

export const getGrowthActivity = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const data = await getRetentionBundle(context.current);

    return res.json({
      ...context.meta,
      activity: data.activity,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH ACTIVITY");
  }
};

export const getGrowthHealth = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const health = await getLiveHealthStatus();

    return res.json({
      timezone: "Asia/Kolkata (IST)",
      ...health,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH HEALTH");
  }
};

export const getGrowthInsights = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const data = await getInsightsBundle(context);
    const acquisition = await getAcquisitionDashboardPayload(context.current);

    return res.json({
      ...context.meta,
      ...data,
      acquisition,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH INSIGHTS");
  }
};

export const getGrowthAcquisition = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const acquisition = await getAcquisitionAnalytics(context.current);

    return res.json({
      ...context.meta,
      acquisition,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH ACQUISITION");
  }
};

export const getGrowthAttribution = async (req, res) => {
  try {
    await ensureGrowthAnalyticsIndexes();
    const context = parseGrowthRequest(req);
    const attribution = await getAttributionAnalytics(context.current);

    return res.json({
      ...context.meta,
      attribution,
    });
  } catch (error) {
    return handleGrowthError(res, error, "GROWTH ATTRIBUTION");
  }
};
