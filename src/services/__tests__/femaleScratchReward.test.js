import test from "node:test";
import assert from "node:assert/strict";

import {
  clampDurationSeconds,
  clampRewardCoins,
  earningAmountForCoins,
  isScratchRewardExpired,
  remainingSeconds,
  serializeScratchRewardForClient,
  isMissedScratchRewardForUser,
} from "../femaleScratchReward.service.js";

test("duration clamps to 0–60 seconds", () => {
  assert.equal(clampDurationSeconds(0), 0);
  assert.equal(clampDurationSeconds(30), 30);
  assert.equal(clampDurationSeconds(60), 60);
  assert.equal(clampDurationSeconds(90), 60);
  assert.equal(clampDurationSeconds(-5), 0);
  assert.equal(clampDurationSeconds("45"), 45);
  assert.equal(clampDurationSeconds("abc"), null);
});

test("reward coins require at least 1 and cap at 100000", () => {
  assert.equal(clampRewardCoins(0), null);
  assert.equal(clampRewardCoins(1), 1);
  assert.equal(clampRewardCoins(250), 250);
  assert.equal(clampRewardCoins(999999), 100000);
  assert.equal(clampRewardCoins("40"), 40);
});

test("reward is expired at or after expiresAt", () => {
  const expiresAt = "2026-09-15T01:00:30.000Z";
  const before = Date.parse("2026-09-15T01:00:29.000Z");
  const exact = Date.parse("2026-09-15T01:00:30.000Z");
  const after = Date.parse("2026-09-15T01:00:31.000Z");

  assert.equal(isScratchRewardExpired(expiresAt, before), false);
  assert.equal(isScratchRewardExpired(expiresAt, exact), true);
  assert.equal(isScratchRewardExpired(expiresAt, after), true);
});

test("remaining seconds round up and never go below 0", () => {
  const expiresAt = "2026-09-15T01:00:30.000Z";

  assert.equal(
    remainingSeconds(expiresAt, Date.parse("2026-09-15T01:00:00.100Z")),
    30
  );
  assert.equal(
    remainingSeconds(expiresAt, Date.parse("2026-09-15T01:00:30.000Z")),
    0
  );
});

test("client payload hides expired rewards", () => {
  const now = Date.parse("2026-09-15T01:00:10.000Z");
  const active = serializeScratchRewardForClient(
    {
      id: 12,
      rewardCoins: 80,
      durationSeconds: 30,
      expiresAt: "2026-09-15T01:00:30.000Z",
      createdAt: "2026-09-15T01:00:00.000Z",
    },
    now
  );
  const expired = serializeScratchRewardForClient(
    {
      id: 12,
      rewardCoins: 80,
      durationSeconds: 30,
      expiresAt: "2026-09-15T01:00:05.000Z",
      createdAt: "2026-09-15T01:00:00.000Z",
    },
    now
  );

  assert.equal(active.id, 12);
  assert.equal(active.rewardCoins, 80);
  assert.equal(active.remainingSeconds, 20);
  assert.equal(expired, null);
});

test("female earning amount uses 50% of coins", () => {
  assert.equal(earningAmountForCoins(100), 50);
  assert.equal(earningAmountForCoins(1), 0.5);
});

test("missed scratch requires expiry, targeting, and no claim", () => {
  const now = Date.parse("2026-09-15T01:01:00.000Z");
  const reward = {
    id: 12,
    targetType: "all",
    expiresAt: "2026-09-15T01:00:30.000Z",
    createdAt: "2026-09-15T01:00:00.000Z",
  };

  assert.equal(
    isMissedScratchRewardForUser({
      reward,
      userId: 9,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      claimedRewardIds: new Set(),
      now,
    }),
    true
  );

  assert.equal(
    isMissedScratchRewardForUser({
      reward,
      userId: 9,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      claimedRewardIds: new Set([12]),
      now,
    }),
    false
  );

  assert.equal(
    isMissedScratchRewardForUser({
      reward,
      userId: 9,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      claimedRewardIds: new Set(),
      now: Date.parse("2026-09-15T01:00:10.000Z"),
    }),
    false
  );

  assert.equal(
    isMissedScratchRewardForUser({
      reward,
      userId: 9,
      userCreatedAt: "2026-09-15T02:00:00.000Z",
      claimedRewardIds: new Set(),
      now,
    }),
    false
  );

  assert.equal(
    isMissedScratchRewardForUser({
      reward: {
        ...reward,
        targetType: "users",
        targetUserIds: [8],
      },
      userId: 9,
      userCreatedAt: "2026-01-01T00:00:00.000Z",
      claimedRewardIds: new Set(),
      now,
    }),
    false
  );
});
