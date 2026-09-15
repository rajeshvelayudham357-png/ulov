import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRechargeExpiresAt,
  clampDurationSeconds,
  clampRechargeExpiryHours,
  clampRewardCoins,
  getIndiaDayBounds,
  isRechargeClaimExpired,
  isScratchRewardExpired,
  isScratchRewardTargetedAtUser,
  normalizeScratchTargetMode,
  purchaseMatchesRequiredPackage,
} from "../maleScratchReward.service.js";

test("male duration clamps to 0–60 seconds", () => {
  assert.equal(clampDurationSeconds(0), 0);
  assert.equal(clampDurationSeconds(60), 60);
  assert.equal(clampDurationSeconds(90), 60);
});

test("male reward coins require at least 1", () => {
  assert.equal(clampRewardCoins(0), null);
  assert.equal(clampRewardCoins(80), 80);
});

test("male scratch expires at the deadline", () => {
  const expiresAt = "2026-09-15T01:00:30.000Z";
  assert.equal(
    isScratchRewardExpired(expiresAt, Date.parse("2026-09-15T01:00:29.000Z")),
    false
  );
  assert.equal(
    isScratchRewardExpired(expiresAt, Date.parse("2026-09-15T01:00:30.000Z")),
    true
  );
});

test("recharge expiry hours default to 24 and clamp to 1–168", () => {
  assert.equal(clampRechargeExpiryHours(undefined), 24);
  assert.equal(clampRechargeExpiryHours(0), 1);
  assert.equal(clampRechargeExpiryHours(24), 24);
  assert.equal(clampRechargeExpiryHours(200), 168);
});

test("reserved recharge expires after the configured window", () => {
  const reservedAt = "2026-09-15T01:00:00.000Z";
  const expiresAt = buildRechargeExpiresAt(reservedAt, 24);

  assert.equal(expiresAt.toISOString(), "2026-09-16T01:00:00.000Z");
  assert.equal(
    isRechargeClaimExpired(expiresAt, Date.parse("2026-09-16T00:59:59.000Z")),
    false
  );
  assert.equal(
    isRechargeClaimExpired(expiresAt, Date.parse("2026-09-16T01:00:00.000Z")),
    true
  );
});

test("qualifying recharge matches package id or coins+price", () => {
  assert.equal(
    purchaseMatchesRequiredPackage({
      packageId: 4,
      coins: 320,
      amount: 129,
      requiredPackageId: 4,
      requiredPackageCoins: 320,
      requiredPackagePrice: 129,
    }),
    true
  );

  assert.equal(
    purchaseMatchesRequiredPackage({
      packageId: 99,
      coins: 320,
      amount: 129,
      requiredPackageId: 4,
      requiredPackageCoins: 320,
      requiredPackagePrice: 129,
    }),
    true
  );

  assert.equal(
    purchaseMatchesRequiredPackage({
      packageId: 99,
      coins: 80,
      amount: 39,
      requiredPackageId: 4,
      requiredPackageCoins: 320,
      requiredPackagePrice: 129,
    }),
    false
  );
});

test("target modes and India-day bounds support today-new and never-recharged audiences", () => {
  assert.equal(normalizeScratchTargetMode("today_new"), "today_new");
  assert.equal(normalizeScratchTargetMode("never_recharged"), "never_recharged");
  assert.equal(normalizeScratchTargetMode("something-else"), "all");

  const { start, end } = getIndiaDayBounds(
    new Date("2026-09-15T01:00:00.000Z")
  );

  assert.equal(start.toISOString(), "2026-09-14T18:30:00.000Z");
  assert.equal(end.toISOString(), "2026-09-15T18:30:00.000Z");
});

test("non-all scratch rewards only target listed users", () => {
  const reward = {
    targetType: "today_new",
    targetUserIds: [11, 22],
  };

  assert.equal(isScratchRewardTargetedAtUser(reward, 11), true);
  assert.equal(isScratchRewardTargetedAtUser(reward, 33), false);
  assert.equal(isScratchRewardTargetedAtUser({ targetType: "all" }, 33), true);
});
