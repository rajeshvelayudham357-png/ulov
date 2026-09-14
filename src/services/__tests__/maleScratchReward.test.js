import test from "node:test";
import assert from "node:assert/strict";

import {
  clampDurationSeconds,
  clampRewardCoins,
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
