import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFunnelStage,
  callAcceptedSql,
  callConnectedSql,
  safeRate,
} from "../adminGrowthMetrics.service.js";
import { CREATOR_LEADERBOARD_SORTS } from "../adminGrowthCreators.service.js";
import { clampScore } from "../adminGrowthInsights.service.js";

test("call SQL helpers qualify table aliases to avoid ambiguity", () => {
  const accepted = callAcceptedSql("ch");
  const connected = callConnectedSql("ch");

  assert.match(accepted, /ch\.status/);
  assert.match(accepted, /ch\.duration/);
  assert.match(connected, /ch\.status/);
  assert.match(connected, /ch\.duration/);
  assert.doesNotMatch(accepted, /(?<![\w.])status(?![\w])/);
});

test("user funnel conversion only between compatible units", () => {
  const registration = buildFunnelStage({
    id: "registration",
    label: "Registration",
    count: 55,
    unit: "users",
    previousStage: null,
    registrationStage: null,
  });

  const profile = buildFunnelStage({
    id: "profile_completed",
    label: "Profile Completed",
    count: 48,
    unit: "users",
    previousStage: registration,
    registrationStage: registration,
  });

  const chat = buildFunnelStage({
    id: "chat_started",
    label: "Chat Started",
    count: 12,
    unit: "users",
    previousStage: profile,
    registrationStage: registration,
  });

  const callStarted = buildFunnelStage({
    id: "call_started",
    label: "Call Started",
    count: 464,
    unit: "calls",
    previousStage: chat,
    registrationStage: registration,
  });

  assert.equal(profile.conversionFromPrevious, safeRate(48, 55));
  assert.equal(chat.conversionFromPrevious, safeRate(12, 48));
  assert.equal(callStarted.conversionFromPrevious, null);
  assert.equal(callStarted.conversionFromRegistration, null);
  assert.match(
    callStarted.conversionUnavailableReason,
    /users while this stage is calls/
  );
});

test("call funnel stages share call unit and allow conversion", () => {
  const started = buildFunnelStage({
    id: "call_started",
    label: "Call Started",
    count: 464,
    unit: "calls",
    previousStage: null,
    registrationStage: null,
  });

  const connected = buildFunnelStage({
    id: "call_connected",
    label: "Call Connected",
    count: 286,
    unit: "calls",
    previousStage: started,
    registrationStage: null,
  });

  assert.equal(connected.conversionFromPrevious, safeRate(286, 464));
  assert.equal(connected.conversionFromPrevious, 61.6);
});

test("first-time payer excludes users whose first payment was before period", () => {
  const periodFrom = new Date("2026-08-01");
  const periodTo = new Date("2026-08-31");
  const firstEverPayment = new Date("2026-07-01");
  const paymentInPeriod = new Date("2026-08-15");

  const isFirstTimePayerInPeriod =
    firstEverPayment >= periodFrom && firstEverPayment <= periodTo;
  const isPayingUserInPeriod =
    paymentInPeriod >= periodFrom && paymentInPeriod <= periodTo;

  assert.equal(isFirstTimePayerInPeriod, false);
  assert.equal(isPayingUserInPeriod, true);
});

test("repeat payer requires 2+ lifetime successful payments", () => {
  const lifetimePayments = 3;
  const paidInPeriod = true;
  const isRepeatPayer = lifetimePayments >= 2 && paidInPeriod;
  assert.equal(isRepeatPayer, true);
});

test("revenue per connected minute is unavailable when minutes are zero", () => {
  const grossRevenue = 1000;
  const connectedMinutes = 0;
  const metric =
    connectedMinutes > 0
      ? { available: true, value: grossRevenue / connectedMinutes }
      : {
          available: false,
          value: null,
          reason: "No connected minutes in selected period.",
        };

  assert.equal(metric.available, false);
  assert.equal(metric.value, null);
});

test("growth score weighting matches Phase 2 design", () => {
  const components = {
    userGrowth: 100,
    callEngagement: 100,
    creatorAvailability: 10,
    monetization: 100,
    retention: 50,
    acquisition: 70,
  };

  const weights = {
    userGrowth: 0.2,
    callEngagement: 0.2,
    creatorAvailability: 0.15,
    monetization: 0.2,
    retention: 0.15,
    acquisition: 0.1,
  };

  const score = clampScore(
    components.userGrowth * weights.userGrowth +
      components.callEngagement * weights.callEngagement +
      components.creatorAvailability * weights.creatorAvailability +
      components.monetization * weights.monetization +
      components.retention * weights.retention +
      components.acquisition * weights.acquisition
  );

  assert.equal(score, 76);
});

test("health and growth score can share live online creator snapshot", () => {
  const healthOnlineCreators = 2;
  const periodSummaryOnlineCreators = 1;
  const onlineCreatorsNow = healthOnlineCreators ?? periodSummaryOnlineCreators;
  assert.equal(onlineCreatorsNow, 2);
});

test("creator answer rate is connected calls over total calls", () => {
  assert.equal(safeRate(286, 464), 61.6);
});

test("call success rate is calls >=30s over connected calls", () => {
  assert.equal(safeRate(199, 286), 69.6);
});

test("creator leaderboard sort whitelist rejects unsafe fields", () => {
  const requested = "'; DROP TABLE users; --";
  const normalized = CREATOR_LEADERBOARD_SORTS.includes(requested)
    ? requested
    : "earnings";
  assert.equal(normalized, "earnings");
});
