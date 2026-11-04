import assert from "node:assert/strict";
import test from "node:test";

import { computeMaleCallCost } from "../../utils/callRate.util.js";
import {
  computeEarnableCoins,
  computeInitialCallCharge,
  computeSettlementEarnings,
  resolveRecordedDuration,
} from "../../utils/callSettlement.util.js";

test("video half-minute schedule is unchanged", () => {
  const rate = 60;
  const cost = (seconds) =>
    computeMaleCallCost({ durationSeconds: seconds, type: "video", ratePerMinute: rate }).maleCost;

  assert.equal(cost(0), 0);
  assert.equal(cost(1), 30);
  assert.equal(cost(30), 30);
  assert.equal(cost(31), 60);
  assert.equal(cost(60), 60);
  assert.equal(cost(61), 120);
  assert.equal(cost(121), 180);
});

test("odd video rates round the half minute up", () => {
  assert.equal(
    computeMaleCallCost({ durationSeconds: 10, type: "video", ratePerMinute: 45 }).maleCost,
    23
  );
});

test("voice bills whole minutes from the first second", () => {
  const cost = (seconds) =>
    computeMaleCallCost({ durationSeconds: seconds, type: "voice", ratePerMinute: 20 }).maleCost;

  assert.equal(cost(1), 20);
  assert.equal(cost(60), 20);
  assert.equal(cost(61), 40);
});

test("initial charge matches the first billing interval", () => {
  assert.equal(computeInitialCallCharge({ type: "video", ratePerMinute: 60 }), 30);
  assert.equal(computeInitialCallCharge({ type: "video", ratePerMinute: 45 }), 23);
  assert.equal(computeInitialCallCharge({ type: "voice", ratePerMinute: 20 }), 20);
});

test("recorded duration ignores the client once acceptedAt is known", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");

  assert.equal(
    resolveRecordedDuration({
      acceptedAt: new Date(now - 125_000),
      endedAt: null,
      createdAt: new Date(now - 140_000),
      clientDuration: 99_999,
      storedDuration: 0,
      now,
    }),
    125
  );

  assert.equal(
    resolveRecordedDuration({
      acceptedAt: new Date(now - 125_000),
      endedAt: null,
      createdAt: new Date(now - 140_000),
      clientDuration: 3,
      storedDuration: 0,
      now,
    }),
    125
  );
});

test("recorded duration for older calls is capped by wall-clock time", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");

  assert.equal(
    resolveRecordedDuration({
      acceptedAt: null,
      createdAt: new Date(now - 90_000),
      clientDuration: 99_999,
      storedDuration: 0,
      now,
    }),
    90
  );

  assert.equal(
    resolveRecordedDuration({
      acceptedAt: null,
      createdAt: new Date(now - 90_000),
      clientDuration: 40,
      storedDuration: 0,
      now,
    }),
    40
  );
});

test("earnable coins never exceed collected coins or recorded cost", () => {
  assert.equal(computeEarnableCoins({ collectedCoins: 20, recordedCost: 2580 }), 20);
  assert.equal(computeEarnableCoins({ collectedCoins: 300, recordedCost: 180 }), 180);
  assert.equal(computeEarnableCoins({ collectedCoins: 0, recordedCost: 180 }), 0);
  assert.equal(computeEarnableCoins({ collectedCoins: -5, recordedCost: 180 }), 0);
});

test("settlement earnings use the creator percentage of earnable coins", () => {
  const result = computeSettlementEarnings({
    collectedCoins: 20,
    recordedCost: 2580,
    coinValue: 0.43125,
    creatorPercentage: 35,
  });

  assert.equal(result.earnableCoins, 20);
  assert.equal(result.femaleEarn, 7);
  assert.equal(result.femaleAmount, Number((20 * 0.43125 * 0.35).toFixed(2)));
});
