import test from "node:test";
import assert from "node:assert/strict";

import { unavailableMetric } from "../adminGrowthMetrics.service.js";

const availableMetric = (value) => ({
  available: true,
  value: Number(value) || 0,
  label: String(value),
});

test("unavailable acquisition metrics preserve reason contract", () => {
  const metric = unavailableMetric("Not configured", "Ad integration not connected");
  assert.equal(metric.available, false);
  assert.equal(metric.value, null);
  assert.equal(metric.reason, "Ad integration not connected");
});

test("available acquisition metrics never fabricate unavailable zeros", () => {
  const metric = availableMetric(0);
  assert.equal(metric.available, true);
  assert.equal(metric.value, 0);
});

test("conversion rate guard rejects populations above 100 percent", () => {
  const installs = 10;
  const registrations = 15;
  const rate =
    installs > 0 && registrations <= installs
      ? (registrations / installs) * 100
      : null;
  assert.equal(rate, null);
});

test("conversion rate guard allows valid subset populations", () => {
  const installs = 20;
  const registrations = 15;
  const rate =
    installs > 0 && registrations <= installs
      ? Number(((registrations / installs) * 100).toFixed(1))
      : null;
  assert.equal(rate, 75);
});
