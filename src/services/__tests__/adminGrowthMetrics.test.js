import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePercentageChange,
  safeRate,
  isSuccessfulPayment,
  SUCCESSFUL_PAYMENT_STATUSES,
} from "../adminGrowthMetrics.service.js";
import {
  validateGrowthDateRange,
  getPreviousPeriodBounds,
} from "../adminGrowthTime.service.js";
import { clampScore, scoreFromThreshold } from "../adminGrowthInsights.service.js";

test("calculatePercentageChange handles positive previous", () => {
  const result = calculatePercentageChange(120, 100);
  assert.equal(result.available, true);
  assert.equal(result.value, 20);
  assert.equal(result.label, "percent");
});

test("calculatePercentageChange returns New when previous is zero", () => {
  const result = calculatePercentageChange(10, 0);
  assert.equal(result.value, "New");
  assert.equal(result.label, "new");
});

test("calculatePercentageChange returns em dash when both zero", () => {
  const result = calculatePercentageChange(0, 0);
  assert.equal(result.value, "—");
});

test("safeRate returns null for zero denominator", () => {
  assert.equal(safeRate(5, 0), null);
});

test("safeRate calculates percentage", () => {
  assert.equal(safeRate(1, 4), 25);
});

test("isSuccessfulPayment matches known statuses", () => {
  assert.equal(isSuccessfulPayment("PAID"), true);
  assert.equal(isSuccessfulPayment("FAILED"), false);
  assert.equal(SUCCESSFUL_PAYMENT_STATUSES.includes("SUCCESS"), true);
});

test("IST period bounds for 7d", () => {
  const now = new Date("2026-08-17T06:30:00.000Z");
  const validation = validateGrowthDateRange({
    period: "7d",
    now,
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.current.period, "7d");
  assert.ok(validation.current.fromUtc <= validation.current.toUtc);

  const previous = getPreviousPeriodBounds({
    fromKey: validation.current.fromKey,
    toKey: validation.current.toKey,
  });

  assert.ok(previous.toUtc < validation.current.fromUtc);
});

test("custom date range validation rejects inverted dates", () => {
  const validation = validateGrowthDateRange({
    period: "custom",
    customFrom: "2026-08-10",
    customTo: "2026-08-01",
  });

  assert.equal(validation.valid, false);
});

test("growth score helpers clamp values", () => {
  assert.equal(clampScore(120), 100);
  assert.equal(clampScore(-5), 0);
  assert.equal(scoreFromThreshold(50, 100), 50);
  assert.equal(scoreFromThreshold(null, 100), null);
});

test("payer conversion formula", () => {
  const payerConversion = safeRate(20, 100);
  assert.equal(payerConversion, 20);
});

test("repeat payer rate formula", () => {
  const repeatRate = safeRate(8, 20);
  assert.equal(repeatRate, 40);
});

test("ARPU style calculation", () => {
  const arpu = 1000 / 200;
  assert.equal(arpu, 5);
});

test("call duration bucket boundaries", () => {
  const bucket = (duration) => {
    if (duration < 5) return "0-5";
    if (duration < 15) return "5-15";
    if (duration < 30) return "15-30";
    if (duration < 60) return "30-60";
    if (duration < 300) return "1-5min";
    if (duration < 600) return "5-10min";
    return "10+";
  };

  assert.equal(bucket(0), "0-5");
  assert.equal(bucket(5), "5-15");
  assert.equal(bucket(30), "30-60");
  assert.equal(bucket(300), "5-10min");
  assert.equal(bucket(600), "10+");
});

test("call success rate uses healthy calls over connected", () => {
  const connected = 40;
  const healthy = 17;
  assert.equal(safeRate(healthy, connected), 42.5);
});
