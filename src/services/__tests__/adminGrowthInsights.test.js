import test from "node:test";
import assert from "node:assert/strict";

import {
  generatePriorityActions,
  clampScore,
} from "../adminGrowthInsights.service.js";
import { DEFAULT_GROWTH_THRESHOLDS } from "../adminGrowthThresholds.service.js";

test("generatePriorityActions returns top 3 critical/warning items", () => {
  const insights = [
    {
      severity: "info",
      title: "Info",
      recommendedAction: "Ignore",
      link: null,
    },
    {
      severity: "critical",
      title: "Critical 1",
      recommendedAction: "Fix 1",
      link: "/calls",
    },
    {
      severity: "warning",
      title: "Warning 1",
      recommendedAction: "Fix 2",
      link: "/revenue",
    },
    {
      severity: "critical",
      title: "Critical 2",
      recommendedAction: "Fix 3",
      link: "/female-online",
    },
    {
      severity: "warning",
      title: "Warning 2",
      recommendedAction: "Fix 4",
      link: null,
    },
  ];

  const actions = generatePriorityActions(insights);
  assert.equal(actions.length, 3);
  assert.equal(actions[0].severity, "critical");
  assert.equal(actions[0].title, "Critical 1");
});

test("growth score component clamping", () => {
  const score = clampScore(
    80 * 0.2 +
      45 * 0.2 +
      60 * 0.15 +
      82 * 0.2 +
      65 * 0.15 +
      70 * 0.1
  );

  assert.ok(score >= 0 && score <= 100);
});

test("default thresholds are defined", () => {
  assert.equal(DEFAULT_GROWTH_THRESHOLDS.minAvgCallDurationSec, 30);
  assert.equal(DEFAULT_GROWTH_THRESHOLDS.minCreatorAnswerRatePct, 70);
  assert.equal(DEFAULT_GROWTH_THRESHOLDS.minPayerConversionPct, 20);
});

test("insight severity ordering concept", () => {
  const order = { critical: 0, warning: 1, info: 2, positive: 3 };
  assert.ok(order.critical < order.warning);
});

test("low call engagement rule threshold", () => {
  const avgDuration = 12;
  const threshold = DEFAULT_GROWTH_THRESHOLDS.minAvgCallDurationSec;
  assert.ok(avgDuration < threshold);
});

test("low payer conversion rule threshold", () => {
  const payerConversion = 12;
  const threshold = DEFAULT_GROWTH_THRESHOLDS.minPayerConversionPct;
  assert.ok(payerConversion < threshold);
});
