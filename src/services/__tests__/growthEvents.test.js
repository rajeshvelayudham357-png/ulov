import test from "node:test";
import assert from "node:assert/strict";

import { GROWTH_EVENT_SET, GROWTH_EVENT_NAMES } from "../../constants/growthEventDefinitions.js";
import { sanitizeMetadata, sanitizeString } from "../growthEvents.service.js";
import { extractGrowthAttribution } from "../../utils/growthAttribution.util.js";
import { buildFunnelStage } from "../adminGrowthMetrics.service.js";
import { GROWTH_FUNNEL_STAGE_SEMANTICS } from "../../constants/growthMetricDefinitions.js";

test("sanitizeMetadata removes sensitive keys", () => {
  const metadata = sanitizeMetadata({
    password: "secret",
    otp: "123456",
    token: "abc",
    orderId: "ORD-1",
    amount: 99,
  });

  assert.deepEqual(metadata, { orderId: "ORD-1", amount: 99 });
});

test("sanitizeMetadata rejects oversized payloads", () => {
  const metadata = sanitizeMetadata({
    payload: "x".repeat(5000),
  });
  assert.equal(metadata, null);
});

test("sanitizeString trims and caps length", () => {
  assert.equal(sanitizeString("  hello  "), "hello");
  assert.equal(sanitizeString("x".repeat(300), 10), "x".repeat(10));
});

test("extractGrowthAttribution reads utm aliases", () => {
  const fields = extractGrowthAttribution({
    body: {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "launch",
      referral_code: "FRIEND10",
    },
  });

  assert.equal(fields.source, "google");
  assert.equal(fields.medium, "cpc");
  assert.equal(fields.campaign, "launch");
  assert.equal(fields.referralCode, "FRIEND10");
});

test("invalid event names are excluded from canonical set", () => {
  assert.equal(GROWTH_EVENT_SET.has("NOT_A_REAL_EVENT"), false);
  assert.equal(GROWTH_EVENT_SET.has(GROWTH_EVENT_NAMES.APP_INSTALL), true);
});

test("event-backed funnel stages do not allow invalid cross-unit conversion", () => {
  const storeVisit = buildFunnelStage({
    id: "store_visit",
    label: "Store Visit",
    count: 100,
    unit: "events",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.store_visit,
    previousStage: null,
    registrationStage: null,
  });

  const install = buildFunnelStage({
    id: "install",
    label: "Install",
    count: 20,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.install,
    previousStage: storeVisit,
    registrationStage: null,
  });

  assert.equal(install.conversionComparable, false);
  assert.match(install.conversionUnavailableReason, /events while this stage is users/);
});

test("creator viewed to chat does not show invalid conversion", () => {
  const creatorViewed = buildFunnelStage({
    id: "creator_viewed",
    label: "Creator Viewed",
    count: 40,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.creator_viewed,
    previousStage: null,
    registrationStage: null,
  });

  const chat = buildFunnelStage({
    id: "chat_started",
    label: "Chat Started",
    count: 12,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.chat_started,
    previousStage: creatorViewed,
    registrationStage: null,
  });

  assert.equal(chat.conversionComparable, false);
});

test("install to registration conversion stays blocked for different populations", () => {
  const install = buildFunnelStage({
    id: "install",
    label: "Install",
    count: 20,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.install,
    previousStage: null,
    registrationStage: null,
  });

  const registration = buildFunnelStage({
    id: "registration",
    label: "Registration",
    count: 15,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.registration,
    previousStage: install,
    registrationStage: null,
  });

  assert.equal(registration.conversionComparable, false);
});

test("public endpoint allowlist excludes server-side business events", () => {
  const publicAllowed = new Set([
    "AD_IMPRESSION",
    "STORE_VISIT",
    "APP_INSTALL",
    "APP_OPEN",
    "SESSION_STARTED",
    "CREATOR_PROFILE_VIEWED",
    "REGISTRATION_STARTED",
  ]);

  assert.equal(publicAllowed.has("REGISTRATION_COMPLETED"), false);
  assert.equal(publicAllowed.has("RECHARGE_COMPLETED"), false);
  assert.equal(publicAllowed.has("PROFILE_COMPLETED"), false);
  assert.equal(publicAllowed.has("CHAT_STARTED"), false);
  assert.equal(publicAllowed.has("APP_OPEN"), true);
});
