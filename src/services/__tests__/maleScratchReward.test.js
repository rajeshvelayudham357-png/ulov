import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRechargeExpiresAt,
  clampDurationSeconds,
  clampRechargeExpiryHours,
  clampRewardCoins,
  isRechargeClaimExpired,
  isScratchRewardExpired,
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
