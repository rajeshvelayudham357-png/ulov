import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { getGstSettings, splitInclusiveGst } from "./gstSettings.service.js";
import {
  getCreatorEarningsTotal,
  getCreatorPayoutTotal,
  getPaymentAggregates,
  periodReplacements,
  roundMoney,
  unavailableMetric,
} from "./adminGrowthMetrics.service.js";
import { getCallCountSummary } from "./adminGrowthMetrics.service.js";
import { countRegisteredUsers } from "./adminGrowthMetrics.service.js";

const paymentIstDateSql = "DATE(DATE_ADD(updatedAt, INTERVAL 330 MINUTE))";

export const getRevenueBreakdown = async (bounds) => {
  const gstSettings = await getGstSettings();
  const gstPercent = Number(gstSettings.gstPercent) || 0;

  const [payments, payoutTotal, earningsTotal, callSummary, registered] =
    await Promise.all([
      getPaymentAggregates(bounds),
      getCreatorPayoutTotal(bounds),
      getCreatorEarningsTotal(bounds),
      getCallCountSummary(bounds),
      countRegisteredUsers(bounds),
    ]);

  const grossRevenue = payments.grossRevenue;
  const { gstAmount, baseRevenue } = splitInclusiveGst(grossRevenue, gstPercent);

  const contributionParts = {
    netRevenue: baseRevenue,
    paymentGatewayFees: unavailableMetric(
      "Not configured",
      "Gateway fee rates are not stored in admin settings."
    ),
    creatorEarnings: {
      available: true,
      value: roundMoney(earningsTotal),
      label: "Creator Earnings (accrual)",
    },
    creatorPayouts: {
      available: true,
      value: roundMoney(payoutTotal),
      label: "Creator Payouts (withdrawn)",
    },
    refunds: unavailableMetric(
      "Not configured",
      "Refunds are not tracked in a dedicated table."
    ),
    marketingSpend: unavailableMetric(
      "Not configured",
      "Google Ads / marketing spend integration is not connected."
    ),
    otherCosts: unavailableMetric(
      "Not configured",
      "Other operating costs are not configured."
    ),
  };

  let estimatedContribution = baseRevenue - payoutTotal;

  const [durationRow] = await sequelize.query(
    `SELECT COALESCE(SUM(duration), 0) / 60 AS connectedMinutes
     FROM call_histories
     WHERE createdAt >= :fromUtc AND createdAt <= :toUtc
       AND (COALESCE(duration, 0) > 0 OR status IN ('accepted','completed','ended','ongoing','in_progress'))`,
    {
      replacements: periodReplacements(bounds),
      type: QueryTypes.SELECT,
    }
  );

  const totalConnectedMinutes = Number(durationRow[0]?.connectedMinutes) || 0;

  return {
    grossRechargeRevenue: roundMoney(grossRevenue),
    gst: roundMoney(gstAmount),
    gstPercent,
    netRevenue: roundMoney(baseRevenue),
    breakdown: contributionParts,
    estimatedContribution: roundMoney(estimatedContribution),
    estimatedProfit: {
      available: false,
      value: null,
      label: "Not configured",
      reason:
        "Profit requires gateway fees, marketing spend, and other costs which are not configured.",
    },
    unitEconomics: {
      revenuePerRegisteredUser:
        registered > 0 ? roundMoney(grossRevenue / registered) : 0,
      revenuePerPayingUser:
        payments.payingUsers > 0
          ? roundMoney(grossRevenue / payments.payingUsers)
          : 0,
      revenuePerCall:
        callSummary.totalCalls > 0
          ? roundMoney(grossRevenue / callSummary.totalCalls)
          : 0,
      revenuePerConnectedMinute:
        totalConnectedMinutes > 0
          ? roundMoney(grossRevenue / totalConnectedMinutes)
          : 0,
    },
    formula: {
      netRevenue: "Gross Revenue - GST (splitInclusiveGst)",
      contribution:
        "Net Revenue - configured costs. Only creator payouts subtracted when other costs unavailable.",
    },
  };
};

export const getDailyRevenueChart = async (bounds) => {
  const gstSettings = await getGstSettings();
  const gstPercent = Number(gstSettings.gstPercent) || 0;
  const replacements = periodReplacements(bounds);

  const rows = await sequelize.query(
    `SELECT ${paymentIstDateSql} AS date,
            COUNT(*) AS transactions,
            COALESCE(SUM(amount), 0) AS grossRevenue
     FROM payment_orders
     WHERE status IN (:paymentStatuses)
       AND updatedAt >= :fromUtc AND updatedAt <= :toUtc
     GROUP BY ${paymentIstDateSql}
     ORDER BY date ASC`,
    { replacements, type: QueryTypes.SELECT }
  );

  return {
    daily: rows.map((row) => {
      const gross = Number(row.grossRevenue) || 0;
      const { gstAmount, baseRevenue } = splitInclusiveGst(gross, gstPercent);
      return {
        date: row.date,
        transactions: Number(row.transactions) || 0,
        grossRevenue: roundMoney(gross),
        netRevenue: roundMoney(baseRevenue),
        gst: roundMoney(gstAmount),
      };
    }),
  };
};

export const getRevenueBundle = async (bounds) => {
  const [breakdown, daily] = await Promise.all([
    getRevenueBreakdown(bounds),
    getDailyRevenueChart(bounds),
  ]);

  return {
    ...breakdown,
    dailyChart: daily.daily,
  };
};

export const getAcquisitionPlaceholder = () => ({
  available: false,
  label: "Google Ads integration not connected",
  metrics: {
    spend: unavailableMetric("Not configured", "Google Ads not connected"),
    impressions: unavailableMetric("Not tracked"),
    clicks: unavailableMetric("Not tracked"),
    ctr: unavailableMetric("Not tracked"),
    cpc: unavailableMetric("Not tracked"),
    installs: unavailableMetric("Not tracked"),
    cpi: unavailableMetric("Not tracked"),
    registrations: unavailableMetric("Not tracked"),
    costPerRegistration: unavailableMetric("Not tracked"),
    firstCalls: unavailableMetric("Not tracked"),
    firstPayers: unavailableMetric("Not tracked"),
    costPerPayer: unavailableMetric("Not tracked"),
    attributedRevenue: unavailableMetric("Not tracked"),
    roas: unavailableMetric("Not tracked"),
  },
  channels: {
    available: false,
    reason: "UTM / install attribution is not tracked on users.",
    sources: ["Google Ads", "Organic", "Referral", "Direct", "Social", "Other"].map(
      (source) => ({
        source,
        available: false,
        reason: "Attribution not tracked",
      })
    ),
  },
});
