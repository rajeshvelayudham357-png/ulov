import test from "node:test";
import assert from "node:assert/strict";

import { ENGAGEMENT_EVENT_TYPES } from "../../constants/engagementEventTypes.js";
import {
  mapGrowthEventToEngagement,
  normalizeEngagementTimestamp,
  pickMonotonicTimestamp,
  recordEngagement,
} from "../engagementRecord.service.js";

test("pickMonotonicTimestamp keeps the newer timestamp", () => {
  const existing = new Date("2026-09-20T10:00:00.000Z");
  const older = new Date("2026-09-19T10:00:00.000Z");
  const newer = new Date("2026-09-21T10:00:00.000Z");

  assert.equal(
    pickMonotonicTimestamp(existing, older)?.toISOString(),
    existing.toISOString()
  );
  assert.equal(
    pickMonotonicTimestamp(existing, newer)?.toISOString(),
    newer.toISOString()
  );
});

test("pickMonotonicTimestamp accepts incoming when existing is null", () => {
  const incoming = new Date("2026-09-18T10:00:00.000Z");
  assert.equal(
    pickMonotonicTimestamp(null, incoming)?.toISOString(),
    incoming.toISOString()
  );
});

test("normalizeEngagementTimestamp rejects invalid and future timestamps", () => {
  assert.equal(normalizeEngagementTimestamp("not-a-date"), null);
  assert.equal(
    normalizeEngagementTimestamp(new Date(Date.now() + 120_000)),
    null
  );
});

test("mapGrowthEventToEngagement maps only supported growth events", () => {
  assert.equal(
    mapGrowthEventToEngagement("CREATOR_PROFILE_VIEWED"),
    ENGAGEMENT_EVENT_TYPES.CREATOR_PROFILE_VIEWED
  );
  assert.equal(
    mapGrowthEventToEngagement("CHAT_STARTED"),
    ENGAGEMENT_EVENT_TYPES.CHAT_STARTED
  );
  assert.equal(
    mapGrowthEventToEngagement("APP_OPEN"),
    ENGAGEMENT_EVENT_TYPES.APP_OPEN
  );
  assert.equal(
    mapGrowthEventToEngagement("SESSION_STARTED"),
    ENGAGEMENT_EVENT_TYPES.SESSION_STARTED
  );
  assert.equal(mapGrowthEventToEngagement("REGISTRATION_COMPLETED"), null);
});

test("recordEngagement rejects invalid users without throwing", async () => {
  const invalidUser = await recordEngagement({
    userId: 0,
    eventType: ENGAGEMENT_EVENT_TYPES.AUTH_LOGIN,
  });
  assert.equal(invalidUser.ok, false);
  assert.equal(invalidUser.reason, "invalid_user_id");

  const invalidEvent = await recordEngagement({
    userId: 123,
    eventType: "NOT_ALLOWED",
  });
  assert.equal(invalidEvent.ok, false);
  assert.equal(invalidEvent.reason, "invalid_event_type");
});

test("recordEngagement rejects invalid occurredAt without throwing", async () => {
  const result = await recordEngagement({
    userId: 123,
    eventType: ENGAGEMENT_EVENT_TYPES.AUTH_LOGIN,
    occurredAt: "bad-date",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_occurred_at");
});
