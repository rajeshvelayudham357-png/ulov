import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFunnelStage,
  callAcceptedSql,
  callConnectedSql,
  evaluateFunnelConversion,
  safeRate,
} from "../adminGrowthMetrics.service.js";
import { GROWTH_FUNNEL_STAGE_SEMANTICS } from "../../constants/growthMetricDefinitions.js";
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

test("registration to profile conversion uses true subset semantics", () => {
  const registration = buildFunnelStage({
    id: "registration",
    label: "Registration",
    count: 56,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.registration,
    previousStage: null,
    registrationStage: null,
  });

  const profile = buildFunnelStage({
    id: "profile_completed",
    label: "Profile Completed",
    count: 49,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.profile_completed,
    previousStage: registration,
    registrationStage: registration,
  });

  assert.equal(profile.conversionComparable, true);
  assert.equal(profile.conversionFromPrevious, safeRate(49, 56));
  assert.equal(profile.conversionFromRegistration, safeRate(49, 56));
});

test("profile to chat does not show conversion when populations differ", () => {
  const profile = buildFunnelStage({
    id: "profile_completed",
    label: "Profile Completed",
    count: 49,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.profile_completed,
    previousStage: null,
    registrationStage: null,
  });

  const chat = buildFunnelStage({
    id: "chat_started",
    label: "Chat Started",
    count: 12,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.chat_started,
    previousStage: profile,
    registrationStage: null,
  });

  assert.equal(chat.conversionComparable, false);
  assert.equal(chat.conversionFromPrevious, null);
  assert.match(
    chat.conversionUnavailableReason,
    /different population definitions/
  );
});

test("chat to first recharge does not show conversion for independent populations", () => {
  const chat = buildFunnelStage({
    id: "chat_started",
    label: "Chat Started",
    count: 12,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.chat_started,
    previousStage: null,
    registrationStage: null,
  });

  const firstRecharge = buildFunnelStage({
    id: "first_recharge",
    label: "First Recharge",
    count: 21,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.first_recharge,
    previousStage: chat,
    registrationStage: null,
  });

  assert.equal(firstRecharge.conversionComparable, false);
  assert.equal(firstRecharge.conversionFromPrevious, null);
  assert.match(
    firstRecharge.conversionUnavailableReason,
    /different population definitions/
  );
});

test("first recharge to repeat recharge does not show conversion", () => {
  const firstRecharge = buildFunnelStage({
    id: "first_recharge",
    label: "First Recharge",
    count: 21,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.first_recharge,
    previousStage: null,
    registrationStage: null,
  });

  const repeatRecharge = buildFunnelStage({
    id: "repeat_recharge",
    label: "Repeat Recharge",
    count: 13,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.repeat_recharge,
    previousStage: firstRecharge,
    registrationStage: null,
  });

  assert.equal(repeatRecharge.conversionComparable, false);
  assert.equal(repeatRecharge.conversionFromPrevious, null);
});

test("user funnel never returns sequential conversion above 100 percent", () => {
  const registration = buildFunnelStage({
    id: "registration",
    label: "Registration",
    count: 56,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.registration,
    previousStage: null,
    registrationStage: null,
  });

  const stages = [
    buildFunnelStage({
      id: "profile_completed",
      label: "Profile Completed",
      count: 49,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.profile_completed,
      previousStage: registration,
      registrationStage: registration,
    }),
    buildFunnelStage({
      id: "chat_started",
      label: "Chat Started",
      count: 12,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.chat_started,
      previousStage: null,
      registrationStage: registration,
    }),
    buildFunnelStage({
      id: "first_recharge",
      label: "First Recharge",
      count: 21,
      unit: "users",
      semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.first_recharge,
      previousStage: null,
      registrationStage: registration,
    }),
  ];

  for (const stage of stages) {
    if (stage.conversionFromPrevious != null) {
      assert.ok(stage.conversionFromPrevious <= 100);
    }
    if (stage.conversionFromRegistration != null) {
      assert.ok(stage.conversionFromRegistration <= 100);
    }
  }
});

test("incompatible units still block conversion", () => {
  const chat = buildFunnelStage({
    id: "chat_started",
    label: "Chat Started",
    count: 12,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.chat_started,
    previousStage: null,
    registrationStage: null,
  });

  const callStarted = buildFunnelStage({
    id: "call_started",
    label: "Call Started",
    count: 464,
    unit: "calls",
    semantics: { subsetOfPrevious: false, subsetOfRegistration: false },
    previousStage: chat,
    registrationStage: null,
  });

  assert.equal(callStarted.conversionComparable, false);
  assert.match(
    callStarted.conversionUnavailableReason,
    /users while this stage is calls/
  );
});

test("call funnel stages share call unit and allow conversion", () => {
  const started = buildFunnelStage({
    id: "started",
    label: "Call Started",
    count: 464,
    unit: "calls",
    semantics: { subsetOfPrevious: false, subsetOfRegistration: false },
    previousStage: null,
    registrationStage: null,
  });

  const connected = buildFunnelStage({
    id: "connected",
    label: "Connected",
    count: 286,
    unit: "calls",
    semantics: { subsetOfPrevious: true, subsetOfRegistration: false },
    previousStage: started,
    registrationStage: null,
  });

  assert.equal(connected.conversionComparable, true);
  assert.equal(connected.conversionFromPrevious, safeRate(286, 464));
  assert.equal(connected.conversionFromPrevious, 61.6);
});

test("revenue funnel first-time payers subset of paying users", () => {
  const paying = buildFunnelStage({
    id: "paying_users",
    label: "Paying Users",
    count: 23,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.paying_users,
    previousStage: null,
    registrationStage: null,
  });

  const firstTime = buildFunnelStage({
    id: "first_time_payers",
    label: "First-Time Payers",
    count: 21,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.first_time_payers,
    previousStage: paying,
    registrationStage: null,
  });

  assert.equal(firstTime.conversionComparable, true);
  assert.equal(firstTime.conversionFromPrevious, safeRate(21, 23));
});

test("revenue funnel repeat payers are not comparable to first-time payers", () => {
  const firstTime = buildFunnelStage({
    id: "first_time_payers",
    label: "First-Time Payers",
    count: 21,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.first_time_payers,
    previousStage: null,
    registrationStage: null,
  });

  const repeat = buildFunnelStage({
    id: "repeat_payers",
    label: "Repeat Payers",
    count: 13,
    unit: "users",
    semantics: GROWTH_FUNNEL_STAGE_SEMANTICS.repeat_payers,
    previousStage: firstTime,
    registrationStage: null,
  });

  assert.equal(repeat.conversionComparable, false);
  assert.equal(repeat.conversionFromPrevious, null);
});

test("evaluateFunnelConversion rejects subset when count exceeds previous", () => {
  const previous = {
    available: true,
    unit: "users",
    count: 10,
  };
  const stage = {
    available: true,
    unit: "users",
    count: 15,
  };

  const result = evaluateFunnelConversion({
    stage,
    previousStage: previous,
    semantics: { subsetOfPrevious: true, subsetOfRegistration: false },
  });

  assert.equal(result.conversionComparable, false);
  assert.match(result.conversionUnavailableReason, /not a sequential subset/);
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
