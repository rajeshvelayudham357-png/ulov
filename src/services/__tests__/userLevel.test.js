import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultLevelConfigRows,
  DEFAULT_MINIMUM_COINS_BY_LEVEL,
} from "../../constants/userLevel.js";
import {
  calculateLevelProgress,
  rankFemaleUserLevels,
  resolveLevelFromEligibleCoins,
  summarizeFemaleUserLevels,
  toCardUserLevel,
  validateLevelConfigRows,
} from "../userLevel.service.js";

const buildConfigRows = (gender = "female") =>
  buildDefaultLevelConfigRows(gender).map((row) => ({
    ...row,
    id: row.levelNumber + 1,
  }));

test("female: 0 call coins resolves to level 0", () => {
  const result = resolveLevelFromEligibleCoins(0, buildConfigRows("female"));

  assert.equal(result.level, 0);
  assert.equal(result.tier, "bronze");
  assert.equal(result.isMaxLevel, false);
  assert.equal(result.currentLevelMinimumCoins, 0);
  assert.equal(result.nextLevelMinimumCoins, DEFAULT_MINIMUM_COINS_BY_LEVEL[1]);
});

test("female: threshold exactly resolves to correct level", () => {
  const result = resolveLevelFromEligibleCoins(
    DEFAULT_MINIMUM_COINS_BY_LEVEL[5],
    buildConfigRows("female")
  );

  assert.equal(result.level, 5);
  assert.equal(result.tier, "silver");
  assert.equal(result.currentLevelMinimumCoins, DEFAULT_MINIMUM_COINS_BY_LEVEL[5]);
});

test("female: coins between thresholds resolve to lower level", () => {
  const result = resolveLevelFromEligibleCoins(7500, buildConfigRows("female"));

  assert.equal(result.level, 3);
  assert.equal(result.currentLevelMinimumCoins, 5000);
  assert.equal(result.nextLevelMinimumCoins, 10000);
});

test("female: level 10 is max level", () => {
  const result = resolveLevelFromEligibleCoins(
    DEFAULT_MINIMUM_COINS_BY_LEVEL[10],
    buildConfigRows("female")
  );

  assert.equal(result.level, 10);
  assert.equal(result.tier, "diamond");
  assert.equal(result.isMaxLevel, true);
  assert.equal(result.nextLevelMinimumCoins, null);
  assert.equal(result.progressPercentage, 100);
});

test("male: 0 recharge resolves to level 0", () => {
  const result = resolveLevelFromEligibleCoins(0, buildConfigRows("male"));

  assert.equal(result.level, 0);
  assert.equal(result.eligibleCoins, 0);
});

test("male: successful recharge amount resolves to matching level", () => {
  const result = resolveLevelFromEligibleCoins(20000, buildConfigRows("male"));

  assert.equal(result.level, 5);
  assert.equal(result.eligibleCoins, 20000);
});

test("male: level 10 is max level", () => {
  const result = resolveLevelFromEligibleCoins(999999, buildConfigRows("male"));

  assert.equal(result.level, 10);
  assert.equal(result.isMaxLevel, true);
  assert.equal(result.progressPercentage, 100);
});

test("progress: 0% at current level threshold", () => {
  const progress = calculateLevelProgress({
    eligibleCoins: 5000,
    currentLevelMinimumCoins: 5000,
    nextLevelMinimumCoins: 10000,
    isMaxLevel: false,
  });

  assert.equal(progress.progressPercentage, 0);
  assert.equal(progress.isMaxLevel, false);
});

test("progress: 50% between thresholds", () => {
  const progress = calculateLevelProgress({
    eligibleCoins: 7500,
    currentLevelMinimumCoins: 5000,
    nextLevelMinimumCoins: 10000,
    isMaxLevel: false,
  });

  assert.equal(progress.progressPercentage, 50);
});

test("progress: 99% near next threshold", () => {
  const progress = calculateLevelProgress({
    eligibleCoins: 9950,
    currentLevelMinimumCoins: 5000,
    nextLevelMinimumCoins: 10000,
    isMaxLevel: false,
  });

  assert.equal(progress.progressPercentage, 99);
});

test("progress: max level returns 100%", () => {
  const progress = calculateLevelProgress({
    eligibleCoins: 150000,
    currentLevelMinimumCoins: 150000,
    nextLevelMinimumCoins: null,
    isMaxLevel: true,
  });

  assert.equal(progress.progressPercentage, 100);
  assert.equal(progress.isMaxLevel, true);
});

test("card payload keeps display fields and drops coin internals", () => {
  const full = resolveLevelFromEligibleCoins(
    DEFAULT_MINIMUM_COINS_BY_LEVEL[7],
    buildConfigRows("female")
  );
  const card = toCardUserLevel(full);

  assert.equal(card.level, 7);
  assert.equal(card.tier, "gold");
  assert.equal(typeof card.themeColor, "string");
  assert.equal("eligibleCoins" in card, false);
  assert.equal("progressPercentage" in card, false);
});

test("validation rejects negative threshold", () => {
  const rows = buildConfigRows("female");
  rows[2].minimumCoins = -1;

  const result = validateLevelConfigRows(rows, "female");

  assert.equal(result.valid, false);
  assert.match(result.message, /cannot be negative/i);
});

test("validation rejects level 0 when minimumCoins is not 0", () => {
  const rows = buildConfigRows("female");
  rows[0].minimumCoins = 100;

  const result = validateLevelConfigRows(rows, "female");

  assert.equal(result.valid, false);
  assert.match(result.message, /Level 0 must have minimumCoins = 0/i);
});

test("validation rejects decreasing thresholds", () => {
  const rows = buildConfigRows("female");
  rows[3].minimumCoins = 1500;

  const result = validateLevelConfigRows(rows, "female");

  assert.equal(result.valid, false);
  assert.match(result.message, /must be greater than level 2/i);
});

test("validation rejects invalid tier", () => {
  const rows = buildConfigRows("female");
  rows[4].tier = "platinum";

  const result = validateLevelConfigRows(rows, "female");

  assert.equal(result.valid, false);
  assert.match(result.message, /invalid tier/i);
});

test("validation rejects visualHeight above 100", () => {
  const rows = buildConfigRows("female");
  rows[1].visualHeight = 101;

  const result = validateLevelConfigRows(rows, "female");

  assert.equal(result.valid, false);
  assert.match(result.message, /visual height/i);
});

test("validation rejects missing level", () => {
  const rows = buildConfigRows("female").filter((row) => row.levelNumber !== 7);

  const result = validateLevelConfigRows(rows, "female");

  assert.equal(result.valid, false);
  assert.match(
    result.message,
    /Missing configuration for level 7|exactly 11 levels/i
  );
});

test("validation rejects duplicate gender + level", () => {
  const rows = buildConfigRows("female");
  rows[10] = { ...rows[9], levelNumber: 9 };

  const result = validateLevelConfigRows(rows, "female");

  assert.equal(result.valid, false);
  assert.match(result.message, /Duplicate configuration for level 9/i);
});

test("validation rejects decreasing visual height", () => {
  const rows = buildConfigRows("female");
  rows[4].visualHeight = 5;

  const result = validateLevelConfigRows(rows, "female");

  assert.equal(result.valid, false);
  assert.match(result.message, /visual height must be greater than or equal/i);
});

test("resolveLevelFromEligibleCoins uses only provided eligible coins input", () => {
  const result = resolveLevelFromEligibleCoins(25000, buildConfigRows("female"));

  assert.equal(result.eligibleCoins, 25000);
  assert.equal(result.level, 5);
});

test("female admin ranking sorts by level then coins, highest first", () => {
  const ranked = rankFemaleUserLevels([
    { id: 3, level: 4, eligibleCoins: 9000 },
    { id: 1, level: 7, eligibleCoins: 22000 },
    { id: 2, level: 7, eligibleCoins: 41000 },
    { id: 4, level: 1, eligibleCoins: 500 },
  ]);

  assert.deepEqual(
    ranked.map((row) => row.id),
    [2, 1, 3, 4]
  );
  assert.deepEqual(
    ranked.map((row) => row.rank),
    [1, 2, 3, 4]
  );

  const summary = summarizeFemaleUserLevels(ranked);
  assert.equal(summary.totalUsers, 4);
  assert.equal(summary.highestLevel, 7);
  assert.equal(summary.levelFivePlus, 2);
  assert.equal(summary.levelCounts[7], 2);
  assert.equal(summary.levelCounts[4], 1);
});

test("default config seeds 11 levels per gender with level 0 at 0 coins", () => {
  const femaleRows = buildDefaultLevelConfigRows("female");
  const maleRows = buildDefaultLevelConfigRows("male");

  assert.equal(femaleRows.length, 11);
  assert.equal(maleRows.length, 11);
  assert.equal(femaleRows[0].minimumCoins, 0);
  assert.equal(maleRows[0].minimumCoins, 0);
  assert.equal(femaleRows[10].tier, "diamond");
  assert.equal(maleRows[10].tier, "diamond");
});
