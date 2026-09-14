export const USER_LEVEL_GENDERS = {
  MALE: "male",
  FEMALE: "female",
};

export const USER_LEVEL_TIERS = [
  "bronze",
  "silver",
  "gold",
  "diamond",
];

export const USER_LEVEL_MIN = 0;
export const USER_LEVEL_MAX = 10;
export const USER_LEVEL_COUNT = USER_LEVEL_MAX - USER_LEVEL_MIN + 1;

export const USER_LEVEL_VISUAL_HEIGHT_MIN = 0;
export const USER_LEVEL_VISUAL_HEIGHT_MAX = 100;

/** Centralized successful recharge statuses for male level calculation. */
export const SUCCESSFUL_RECHARGE_STATUSES = [
  "PAID",
  "SUCCESS",
  "CAPTURED",
  "credited",
  "COMPLETED",
  "completed",
  "success",
  "paid",
];

const DEFAULT_TIER_FOR_LEVEL = (levelNumber) => {
  if (levelNumber <= 2) {
    return "bronze";
  }

  if (levelNumber <= 5) {
    return "silver";
  }

  if (levelNumber <= 8) {
    return "gold";
  }

  return "diamond";
};

const DEFAULT_THEME_COLORS = {
  bronze: "#CD7F32",
  silver: "#C0C0C0",
  gold: "#D4AF37",
  diamond: "#7DD3FC",
};

/** Placeholder thresholds — editable from Admin. */
export const DEFAULT_MINIMUM_COINS_BY_LEVEL = [
  0,
  500,
  2_000,
  5_000,
  10_000,
  20_000,
  35_000,
  50_000,
  75_000,
  100_000,
  150_000,
];

export const buildDefaultLevelConfigRows = (gender) =>
  DEFAULT_MINIMUM_COINS_BY_LEVEL.map((minimumCoins, levelNumber) => {
    const tier = DEFAULT_TIER_FOR_LEVEL(levelNumber);
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

    return {
      gender,
      levelNumber,
      tier,
      minimumCoins,
      displayName: `${tierLabel} Level ${levelNumber}`,
      theme: tier,
      visualHeight: Math.min(
        USER_LEVEL_VISUAL_HEIGHT_MAX,
        10 + levelNumber * 9
      ),
      badgeIcon: tier,
      themeColor: DEFAULT_THEME_COLORS[tier],
      isActive: true,
    };
  });

export const normalizeUserLevelGender = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "male" || normalized === "m") {
    return USER_LEVEL_GENDERS.MALE;
  }

  if (normalized === "female" || normalized === "f") {
    return USER_LEVEL_GENDERS.FEMALE;
  }

  return null;
};

export const normalizeUserLevelTier = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return USER_LEVEL_TIERS.includes(normalized) ? normalized : null;
};
