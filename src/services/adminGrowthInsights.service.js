import { getGrowthThresholds } from "./adminGrowthThresholds.service.js";
import {
  calculatePercentageChange,
  getExecutiveSummary,
} from "./adminGrowthMetrics.service.js";
import { getCallQualityMetrics } from "./adminGrowthCalls.service.js";
import { getCreatorAvailabilitySummary } from "./adminGrowthCreators.service.js";
import { getMonetizationMetrics } from "./adminGrowthMonetization.service.js";
import { getRetentionCohorts } from "./adminGrowthRetention.service.js";
import { getAcquisitionPlaceholder } from "./adminGrowthRevenue.service.js";
import { getLiveHealthStatus } from "./adminGrowthHealth.service.js";

const clampScore = (value) =>
  Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const scoreFromThreshold = (value, target, maxScore = 100) => {
  if (value === null || value === undefined) {
    return null;
  }
  const ratio = Number(value) / Number(target);
  return clampScore(Math.min(ratio, 1) * maxScore);
};

export const computeGrowthScore = async ({
  current,
  previous,
  summary,
  callQuality,
  creatorSummary,
  monetization,
  retention,
  thresholds,
}) => {
  const registrationChange = calculatePercentageChange(
    summary.metrics.find((m) => m.key === "REGISTERED_USERS")?.current || 0,
    summary.metrics.find((m) => m.key === "REGISTERED_USERS")?.previous || 0
  );

  const userGrowthScore =
    registrationChange.label === "new"
      ? 100
      : registrationChange.label === "percent"
        ? clampScore(
            50 +
              Math.min(
                50,
                Math.max(-50, Number(registrationChange.value) || 0)
              )
          )
        : 50;

  const callEngagementScore = scoreFromThreshold(
    callQuality.metrics.callSuccessRate,
    thresholds.minCallSuccessRatePct
  );

  const creatorAvailabilityScore = scoreFromThreshold(
    creatorSummary.onlineCreatorsNow,
    thresholds.minHealthyOnlineCreators
  );

  const monetizationScore = scoreFromThreshold(
    monetization.rates.payerConversionRate,
    thresholds.minPayerConversionPct
  );

  let retentionScore = 50;
  const recentCohorts = retention.cohorts.slice(-7);
  const d7Values = recentCohorts
    .map((c) => c.retention?.d7)
    .filter((r) => r?.available && r.value !== null)
    .map((r) => r.value);

  if (d7Values.length > 0) {
    const avgD7 =
      d7Values.reduce((sum, value) => sum + value, 0) / d7Values.length;
    retentionScore = scoreFromThreshold(avgD7, 25);
  }

  const acquisitionScore = {
    value: null,
    available: false,
    reason: "Google Ads / attribution not connected — neutral score applied.",
    neutralScore: 70,
  };

  const weights = {
    userGrowth: 0.2,
    callEngagement: 0.2,
    creatorAvailability: 0.15,
    monetization: 0.2,
    retention: 0.15,
    acquisition: 0.1,
  };

  const components = {
    userGrowth: userGrowthScore,
    callEngagement: callEngagementScore ?? 0,
    creatorAvailability: creatorAvailabilityScore ?? 0,
    monetization: monetizationScore ?? 0,
    retention: retentionScore,
    acquisition: acquisitionScore.neutralScore,
  };

  const score = clampScore(
    components.userGrowth * weights.userGrowth +
      components.callEngagement * weights.callEngagement +
      components.creatorAvailability * weights.creatorAvailability +
      components.monetization * weights.monetization +
      components.retention * weights.retention +
      components.acquisition * weights.acquisition
  );

  return {
    score,
    maxScore: 100,
    components,
    weights,
    thresholds,
    acquisition: acquisitionScore,
    explanation:
      "Weighted average of component scores. Acquisition uses neutral 70 until Google Ads is connected.",
  };
};

export const generateInsights = async ({
  current,
  previous,
  summary,
  callQuality,
  creatorSummary,
  monetization,
  thresholds,
}) => {
  const insights = [];
  const avgDuration = callQuality.metrics.avgDurationSeconds;
  const callSuccessRate = callQuality.metrics.callSuccessRate;
  const creatorAnswerRate = callQuality.metrics.creatorAnswerRate;
  const payerConversion = monetization.rates.payerConversionRate;
  const repeatPayerRate = monetization.rates.repeatPayerRate;

  const netCurrent =
    summary.metrics.find((m) => m.label === "Net Revenue")?.current || 0;
  const netPrevious =
    summary.metrics.find((m) => m.label === "Net Revenue")?.previous || 0;
  const revenueChange = calculatePercentageChange(netCurrent, netPrevious);

  const regCurrent =
    summary.metrics.find((m) => m.key === "REGISTERED_USERS")?.current || 0;
  const regPrevious =
    summary.metrics.find((m) => m.key === "REGISTERED_USERS")?.previous || 0;
  const regChange = calculatePercentageChange(regCurrent, regPrevious);

  if (avgDuration < thresholds.minAvgCallDurationSec) {
    insights.push({
      id: "LOW_CALL_ENGAGEMENT",
      severity: "critical",
      metric: "averageCallDurationSeconds",
      currentValue: avgDuration,
      threshold: thresholds.minAvgCallDurationSec,
      title: "Call engagement is low",
      description:
        "Average call duration is below the configured threshold. Short calls may indicate connection, acceptance, or early hangup issues.",
      recommendedAction:
        "Investigate call connection quality, creator acceptance rates, and early hangups.",
      link: "/calls",
    });
  }

  if (
    creatorAnswerRate !== null &&
    creatorAnswerRate < thresholds.minCreatorAnswerRatePct
  ) {
    insights.push({
      id: "LOW_CREATOR_ANSWER_RATE",
      severity: "critical",
      metric: "creatorAnswerRate",
      currentValue: creatorAnswerRate,
      threshold: thresholds.minCreatorAnswerRatePct,
      title: "Creator answer rate is low",
      description:
        "Creators are not answering enough incoming calls, which may cause user drop-off.",
      recommendedAction:
        "Increase creator coverage during high-demand hours and review creator availability.",
      link: "/female-online",
    });
  }

  if (
    creatorSummary.onlineCreatorsNow < thresholds.minOnlineCreators
  ) {
    insights.push({
      id: "LOW_CREATOR_AVAILABILITY",
      severity: "critical",
      metric: "onlineCreatorsNow",
      currentValue: creatorSummary.onlineCreatorsNow,
      threshold: thresholds.minOnlineCreators,
      title: "Creator availability is low",
      description:
        "Fewer creators are online than the configured minimum.",
      recommendedAction:
        "Increase creator coverage, especially during peak call hours.",
      link: "/female-online",
    });
  }

  if (
    payerConversion !== null &&
    payerConversion < thresholds.minPayerConversionPct
  ) {
    insights.push({
      id: "LOW_PAYER_CONVERSION",
      severity: "warning",
      metric: "payerConversionRate",
      currentValue: payerConversion,
      threshold: thresholds.minPayerConversionPct,
      title: "Low payer conversion",
      description:
        "A large share of registered users are not converting to paying users.",
      recommendedAction:
        "Review onboarding, first-call experience, and recharge prompts.",
      link: "/revenue",
    });
  }

  if (
    repeatPayerRate !== null &&
    repeatPayerRate < thresholds.minRepeatPayerRatePct
  ) {
    insights.push({
      id: "LOW_REPEAT_PAYMENT",
      severity: "warning",
      metric: "repeatPayerRate",
      currentValue: repeatPayerRate,
      threshold: thresholds.minRepeatPayerRatePct,
      title: "Low repeat recharge rate",
      description: "Users are not returning to recharge at the expected rate.",
      recommendedAction:
        "Consider retention campaigns and personalized recharge offers.",
      link: "/broadcast",
    });
  }

  if (
    revenueChange.label === "percent" &&
    Number(revenueChange.value) <= -thresholds.maxRevenueDropPct
  ) {
    insights.push({
      id: "REVENUE_DECLINE",
      severity: "critical",
      metric: "netRevenueChangePct",
      currentValue: revenueChange.value,
      threshold: -thresholds.maxRevenueDropPct,
      title: "Revenue declined vs previous period",
      description: `Net revenue changed by ${revenueChange.value}% compared to the previous period.`,
      recommendedAction: "Review recharge funnel, call quality, and creator availability.",
      link: "/revenue",
    });
  }

  if (
    regChange.label === "percent" &&
    Number(regChange.value) <= -20
  ) {
    insights.push({
      id: "REGISTRATION_DECLINE",
      severity: "warning",
      metric: "registrationChangePct",
      currentValue: regChange.value,
      threshold: -20,
      title: "Registrations declined",
      description: "New user registrations are down versus the previous period.",
      recommendedAction: "Review acquisition channels and registration flow.",
      link: "/analytics",
    });
  }

  if (
    revenueChange.label === "percent" &&
    Number(revenueChange.value) >= thresholds.revenueGrowthPositivePct &&
    regChange.label === "percent" &&
    Number(regChange.value) >= 0
  ) {
    insights.push({
      id: "POSITIVE_GROWTH",
      severity: "positive",
      metric: "revenueAndRegistration",
      currentValue: revenueChange.value,
      threshold: thresholds.revenueGrowthPositivePct,
      title: "Positive growth signal",
      description:
        "Revenue is increasing and registrations are stable or growing.",
      recommendedAction:
        "Consider gradually increasing acquisition spend once attribution is connected.",
      link: "/revenue",
    });
  }

  const acquisition = getAcquisitionPlaceholder();
  insights.push({
    id: "ACQUISITION_NOT_CONNECTED",
    severity: "info",
    metric: "googleAds",
    currentValue: null,
    threshold: null,
    title: acquisition.label,
    description: acquisition.metrics.spend.reason,
    recommendedAction:
      "Connect Google Ads or import campaign spend data in Phase 5.",
    link: null,
  });

  const severityOrder = {
    critical: 0,
    warning: 1,
    info: 2,
    positive: 3,
  };

  insights.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
  );

  return insights;
};

export const generatePriorityActions = (insights) =>
  insights
    .filter((item) => item.severity === "critical" || item.severity === "warning")
    .slice(0, 3)
    .map((item, index) => ({
      rank: index + 1,
      severity: item.severity,
      title: item.title,
      action: item.recommendedAction,
      link: item.link,
    }));

export const generateAlerts = (insights, callQuality, thresholds) => {
  const alerts = insights.filter((item) =>
    ["critical", "warning"].includes(item.severity)
  );

  if (
    callQuality.metrics.failedCallRate !== null &&
    callQuality.metrics.failedCallRate > thresholds.maxCallFailureRatePct
  ) {
    alerts.push({
      id: "HIGH_CALL_FAILURE_RATE",
      severity: "critical",
      title: "High call failure rate",
      metric: "failedCallRate",
      currentValue: callQuality.metrics.failedCallRate,
      threshold: thresholds.maxCallFailureRatePct,
    });
  }

  return alerts.slice(0, 8);
};

export const getInsightsBundle = async ({ current, previous }) => {
  const thresholds = await getGrowthThresholds();

  const [
    summary,
    callQuality,
    creatorSummary,
    monetization,
    retention,
    health,
  ] = await Promise.all([
    getExecutiveSummary({ current, previous }),
    getCallQualityMetrics(current),
    getCreatorAvailabilitySummary(current),
    getMonetizationMetrics(current),
    getRetentionCohorts(current),
    getLiveHealthStatus(),
  ]);

  const growthScore = await computeGrowthScore({
    current,
    previous,
    summary,
    callQuality,
    creatorSummary,
    monetization,
    retention,
    thresholds,
  });

  const insights = await generateInsights({
    current,
    previous,
    summary,
    callQuality,
    creatorSummary,
    monetization,
    thresholds,
  });

  return {
    growthScore,
    insights,
    priorityActions: generatePriorityActions(insights),
    alerts: generateAlerts(insights, callQuality, thresholds),
    thresholds,
    health,
  };
};

// Re-export for tests
export { clampScore, scoreFromThreshold };
