import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGAGEMENT_BUCKETS,
  getIstDaysSinceMeaningfulActivity,
  resolveEngagementBucket,
} from "../maleEngagementBuckets.service.js";

const istMidnightUtc = (dateKey) =>
  new Date(`${dateKey}T00:00:00+05:30`);

test("null activity resolves to NEVER_ACTIVE", () => {
  assert.equal(
    resolveEngagementBucket(null, false),
    ENGAGEMENT_BUCKETS.NEVER_ACTIVE
  );
});

test("midnight IST boundary: activity today yields ACTIVE_TODAY", () => {
  const today = "2026-09-24";
  const activityAt = istMidnightUtc(today);
  activityAt.setUTCHours(activityAt.getUTCHours() + 2);

  const days = getIstDaysSinceMeaningfulActivity(activityAt, today);
  assert.equal(days, 0);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.ACTIVE_TODAY
  );
});

test("exactly 7 days maps to ACTIVE_1_7_DAYS", () => {
  const today = "2026-09-24";
  const days = getIstDaysSinceMeaningfulActivity(
    istMidnightUtc("2026-09-17"),
    today
  );
  assert.equal(days, 7);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.ACTIVE_1_7_DAYS
  );
});

test("exactly 8 days maps to AT_RISK_8_14_DAYS", () => {
  const today = "2026-09-24";
  const days = getIstDaysSinceMeaningfulActivity(
    istMidnightUtc("2026-09-16"),
    today
  );
  assert.equal(days, 8);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.AT_RISK_8_14_DAYS
  );
});

test("exactly 14 days maps to AT_RISK_8_14_DAYS", () => {
  const today = "2026-09-24";
  const days = getIstDaysSinceMeaningfulActivity(
    istMidnightUtc("2026-09-10"),
    today
  );
  assert.equal(days, 14);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.AT_RISK_8_14_DAYS
  );
});

test("exactly 15 days maps to DORMANT_15_30_DAYS", () => {
  const today = "2026-09-24";
  const days = getIstDaysSinceMeaningfulActivity(
    istMidnightUtc("2026-09-09"),
    today
  );
  assert.equal(days, 15);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.DORMANT_15_30_DAYS
  );
});

test("exactly 30 days maps to DORMANT_15_30_DAYS", () => {
  const today = "2026-09-24";
  const days = getIstDaysSinceMeaningfulActivity(
    istMidnightUtc("2026-08-25"),
    today
  );
  assert.equal(days, 30);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.DORMANT_15_30_DAYS
  );
});

test("exactly 31 days maps to DORMANT_31_60_DAYS", () => {
  const today = "2026-09-24";
  const days = getIstDaysSinceMeaningfulActivity(
    istMidnightUtc("2026-08-24"),
    today
  );
  assert.equal(days, 31);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.DORMANT_31_60_DAYS
  );
});

test("exactly 60 days maps to DORMANT_31_60_DAYS", () => {
  const today = "2026-09-24";
  const days = getIstDaysSinceMeaningfulActivity(
    istMidnightUtc("2026-07-26"),
    today
  );
  assert.equal(days, 60);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.DORMANT_31_60_DAYS
  );
});

test("exactly 61 days maps to DORMANT_60_PLUS_DAYS", () => {
  const today = "2026-09-24";
  const days = getIstDaysSinceMeaningfulActivity(
    istMidnightUtc("2026-07-25"),
    today
  );
  assert.equal(days, 61);
  assert.equal(
    resolveEngagementBucket(days, true),
    ENGAGEMENT_BUCKETS.DORMANT_60_PLUS_DAYS
  );
});
