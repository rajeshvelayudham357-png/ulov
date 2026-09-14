import { QueryTypes } from "sequelize";

import {
  SUCCESSFUL_RECHARGE_STATUSES,
  USER_LEVEL_GENDERS,
  USER_LEVEL_MAX,
  USER_LEVEL_MIN,
  USER_LEVEL_TIERS,
  USER_LEVEL_VISUAL_HEIGHT_MAX,
  USER_LEVEL_VISUAL_HEIGHT_MIN,
  normalizeUserLevelGender,
  normalizeUserLevelTier,
} from "../constants/userLevel.js";
import { sequelize } from "../config/database.js";
import {
  USER_LEVEL_CONFIG_TABLE,
  ensureUserLevelSchema,
} from "./userLevelSchema.service.js";

const CONFIG_CACHE_TTL_MS = 60_000;
const configCache = new Map();

const toNumber = (value) => Number(value) || 0;

const mapConfigRow = (row) => ({
  id: Number(row.id),
  gender: String(row.gender),
  levelNumber: Number(row.levelNumber),
  tier: String(row.tier),
  minimumCoins: toNumber(row.minimumCoins),
  displayName: String(row.displayName || ""),
  theme: String(row.theme || ""),
  visualHeight: Number(row.visualHeight) || 0,
  badgeIcon: row.badgeIcon ? String(row.badgeIcon) : null,
  themeColor: row.themeColor ? String(row.themeColor) : null,
  isActive: Boolean(Number(row.isActive ?? 1)),
});

export const validateLevelConfigRows = (rows, gender) => {
  const normalizedGender = normalizeUserLevelGender(gender);

  if (!normalizedGender) {
    return { valid: false, message: "Invalid gender" };
  }

  if (!Array.isArray(rows) || rows.length !== 11) {
    return {
      valid: false,
      message: "Configuration must include exactly 11 levels (0 through 10)",
    };
  }

  const seenLevels = new Set();
  let previousMinimumCoins = null;
  let previousVisualHeight = null;

  for (const rawRow of rows) {
    const levelNumber = Number(rawRow.levelNumber);

    if (
      !Number.isInteger(levelNumber) ||
      levelNumber < USER_LEVEL_MIN ||
      levelNumber > USER_LEVEL_MAX
    ) {
      return {
        valid: false,
        message: `Level number must be between ${USER_LEVEL_MIN} and ${USER_LEVEL_MAX}`,
      };
    }

    if (seenLevels.has(levelNumber)) {
      return {
        valid: false,
        message: `Duplicate configuration for level ${levelNumber}`,
      };
    }

    seenLevels.add(levelNumber);

    const minimumCoins = toNumber(rawRow.minimumCoins);

    if (minimumCoins < 0) {
      return {
        valid: false,
        message: `Level ${levelNumber} minimum coins cannot be negative`,
      };
    }

    if (levelNumber === USER_LEVEL_MIN && minimumCoins !== 0) {
      return {
        valid: false,
        message: "Level 0 must have minimumCoins = 0",
      };
    }

    if (
      previousMinimumCoins !== null &&
      minimumCoins <= previousMinimumCoins
    ) {
      return {
        valid: false,
        message: `Level ${levelNumber} minimum coins must be greater than level ${levelNumber - 1}`,
      };
    }

    const tier = normalizeUserLevelTier(rawRow.tier);

    if (!tier) {
      return {
        valid: false,
        message: `Level ${levelNumber} has an invalid tier`,
      };
    }

    const visualHeight = Number(rawRow.visualHeight);

    if (
      !Number.isFinite(visualHeight) ||
      visualHeight < USER_LEVEL_VISUAL_HEIGHT_MIN ||
      visualHeight > USER_LEVEL_VISUAL_HEIGHT_MAX
    ) {
      return {
        valid: false,
        message: `Level ${levelNumber} visual height must be between ${USER_LEVEL_VISUAL_HEIGHT_MIN} and ${USER_LEVEL_VISUAL_HEIGHT_MAX}`,
      };
    }

    if (
      previousVisualHeight !== null &&
      visualHeight < previousVisualHeight
    ) {
      return {
        valid: false,
        message: `Level ${levelNumber} visual height must be greater than or equal to the previous level`,
      };
    }

    const displayName = String(rawRow.displayName ?? "").trim();

    if (!displayName) {
      return {
        valid: false,
        message: `Level ${levelNumber} display name is required`,
      };
    }

    const theme = String(rawRow.theme ?? "").trim();

    if (!theme) {
      return {
        valid: false,
        message: `Level ${levelNumber} theme is required`,
      };
    }

    previousMinimumCoins = minimumCoins;
    previousVisualHeight = visualHeight;
  }

  for (let level = USER_LEVEL_MIN; level <= USER_LEVEL_MAX; level += 1) {
    if (!seenLevels.has(level)) {
      return {
        valid: false,
        message: `Missing configuration for level ${level}`,
      };
    }
  }

  return { valid: true };
};

export const calculateLevelProgress = ({
  eligibleCoins,
  currentLevelMinimumCoins,
  nextLevelMinimumCoins,
  isMaxLevel,
}) => {
  if (isMaxLevel || nextLevelMinimumCoins == null) {
    return {
      progressPercentage: 100,
      isMaxLevel: true,
    };
  }

  const span = nextLevelMinimumCoins - currentLevelMinimumCoins;

  if (span <= 0) {
    return {
      progressPercentage: 0,
      isMaxLevel: false,
    };
  }

  const progress = Math.max(
    0,
    Math.min(
      100,
      Math.round(((eligibleCoins - currentLevelMinimumCoins) / span) * 100)
    )
  );

  return {
    progressPercentage: progress,
    isMaxLevel: false,
  };
};

export const resolveLevelFromEligibleCoins = (eligibleCoins, configRows) => {
  const activeRows = [...configRows]
    .filter((row) => row.isActive)
    .sort((a, b) => a.levelNumber - b.levelNumber);

  if (activeRows.length === 0) {
    throw new Error("No active user level configuration found");
  }

  const safeEligibleCoins = Math.max(0, toNumber(eligibleCoins));

  let current = activeRows[0];

  for (const row of activeRows) {
    if (safeEligibleCoins >= row.minimumCoins) {
      current = row;
    } else {
      break;
    }
  }

  const currentIndex = activeRows.findIndex(
    (row) => row.levelNumber === current.levelNumber
  );
  const next =
    currentIndex >= 0 && currentIndex < activeRows.length - 1
      ? activeRows[currentIndex + 1]
      : null;

  const isMaxLevel = current.levelNumber === USER_LEVEL_MAX || !next;

  const progress = calculateLevelProgress({
    eligibleCoins: safeEligibleCoins,
    currentLevelMinimumCoins: current.minimumCoins,
    nextLevelMinimumCoins: next?.minimumCoins ?? null,
    isMaxLevel,
  });

  return {
    level: current.levelNumber,
    tier: current.tier,
    displayName: current.displayName,
    eligibleCoins: safeEligibleCoins,
    currentLevelMinimumCoins: current.minimumCoins,
    nextLevelMinimumCoins: isMaxLevel ? null : next.minimumCoins,
    progressPercentage: progress.progressPercentage,
    isMaxLevel: progress.isMaxLevel,
    theme: current.theme,
    visualHeight: current.visualHeight,
    badgeIcon: current.badgeIcon,
    themeColor: current.themeColor,
  };
};

const getCachedConfig = (gender) => {
  const cached = configCache.get(gender);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows;
  }

  return null;
};

const setCachedConfig = (gender, rows) => {
  configCache.set(gender, {
    rows,
    expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
  });
};

export const invalidateLevelConfigCache = (gender = null) => {
  if (gender) {
    configCache.delete(normalizeUserLevelGender(gender));
    return;
  }

  configCache.clear();
};

export const getLevelConfig = async (gender) => {
  await ensureUserLevelSchema();

  const normalizedGender = normalizeUserLevelGender(gender);

  if (!normalizedGender) {
    throw new Error("Invalid gender");
  }

  const cached = getCachedConfig(normalizedGender);

  if (cached) {
    return cached;
  }

  const rows = await sequelize.query(
    `SELECT *
     FROM ${USER_LEVEL_CONFIG_TABLE}
     WHERE gender = :gender
     ORDER BY levelNumber ASC`,
    {
      replacements: { gender: normalizedGender },
      type: QueryTypes.SELECT,
    }
  );

  const mapped = rows.map(mapConfigRow);
  setCachedConfig(normalizedGender, mapped);

  return mapped;
};

export const getEligibleCoins = async (userId, gender) => {
  const normalizedGender = normalizeUserLevelGender(gender);
  const userIdNum = Number(userId);

  if (!normalizedGender || !Number.isFinite(userIdNum) || userIdNum <= 0) {
    return 0;
  }

  if (normalizedGender === USER_LEVEL_GENDERS.FEMALE) {
    const [row] = await sequelize.query(
      `SELECT COALESCE(SUM(coins), 0) AS totalCoins
       FROM earnings
       WHERE userId = :userId
         AND callId IS NOT NULL`,
      {
        replacements: { userId: userIdNum },
        type: QueryTypes.SELECT,
      }
    );

    return toNumber(row?.totalCoins);
  }

  const [row] = await sequelize.query(
    `SELECT COALESCE(SUM(coins), 0) AS totalCoins
     FROM payment_orders
     WHERE userId = :userId
       AND status IN (:statuses)`,
    {
      replacements: {
        userId: userIdNum,
        statuses: SUCCESSFUL_RECHARGE_STATUSES,
      },
      type: QueryTypes.SELECT,
    }
  );

  return toNumber(row?.totalCoins);
};

export const resolveUserLevel = async (userId, gender) => {
  const normalizedGender = normalizeUserLevelGender(gender);

  if (!normalizedGender) {
    return null;
  }

  const [configRows, eligibleCoins] = await Promise.all([
    getLevelConfig(normalizedGender),
    getEligibleCoins(userId, normalizedGender),
  ]);

  return resolveLevelFromEligibleCoins(eligibleCoins, configRows);
};

export const attachUserLevel = async (user) => {
  if (!user) {
    return null;
  }

  const data = typeof user.toJSON === "function" ? user.toJSON() : user;
  const gender = data.gender;

  if (!gender) {
    return null;
  }

  try {
    return await resolveUserLevel(data.id, gender);
  } catch (error) {
    console.log("USER LEVEL RESOLVE ERROR", data.id, error.message);
    return null;
  }
};

export const toCardUserLevel = (level) => {
  if (!level) {
    return null;
  }

  return {
    level: Number(level.level) || 0,
    tier: String(level.tier || ""),
    displayName: String(level.displayName || ""),
    theme: String(level.theme || ""),
    themeColor: level.themeColor ? String(level.themeColor) : null,
    badgeIcon: level.badgeIcon ? String(level.badgeIcon) : null,
  };
};

const getEligibleCoinsByUserIds = async (userIds, gender) => {
  const normalizedGender = normalizeUserLevelGender(gender);
  const ids = [...new Set(userIds.map(Number).filter((id) => id > 0))];
  const coinsByUserId = new Map();

  if (!normalizedGender || ids.length === 0) {
    return coinsByUserId;
  }

  const rows =
    normalizedGender === USER_LEVEL_GENDERS.FEMALE
      ? await sequelize.query(
          `SELECT userId, COALESCE(SUM(coins), 0) AS totalCoins
           FROM earnings
           WHERE callId IS NOT NULL
             AND userId IN (:userIds)
           GROUP BY userId`,
          {
            replacements: { userIds: ids },
            type: QueryTypes.SELECT,
          }
        )
      : await sequelize.query(
          `SELECT userId, COALESCE(SUM(coins), 0) AS totalCoins
           FROM payment_orders
           WHERE userId IN (:userIds)
             AND status IN (:statuses)
           GROUP BY userId`,
          {
            replacements: {
              userIds: ids,
              statuses: SUCCESSFUL_RECHARGE_STATUSES,
            },
            type: QueryTypes.SELECT,
          }
        );

  for (const row of rows) {
    coinsByUserId.set(Number(row.userId), toNumber(row.totalCoins));
  }

  return coinsByUserId;
};

export const attachUserLevels = async (users = []) => {
  if (!Array.isArray(users) || users.length === 0) {
    return users;
  }

  const femaleIds = [];
  const maleIds = [];

  for (const user of users) {
    const gender = normalizeUserLevelGender(user?.gender);
    const id = Number(user?.id);

    if (!gender || !Number.isFinite(id) || id <= 0) {
      continue;
    }

    if (gender === USER_LEVEL_GENDERS.FEMALE) {
      femaleIds.push(id);
    } else {
      maleIds.push(id);
    }
  }

  const [femaleConfig, maleConfig, femaleCoins, maleCoins] = await Promise.all([
    femaleIds.length ? getLevelConfig(USER_LEVEL_GENDERS.FEMALE) : [],
    maleIds.length ? getLevelConfig(USER_LEVEL_GENDERS.MALE) : [],
    getEligibleCoinsByUserIds(femaleIds, USER_LEVEL_GENDERS.FEMALE),
    getEligibleCoinsByUserIds(maleIds, USER_LEVEL_GENDERS.MALE),
  ]);

  return users.map((user) => {
    const gender = normalizeUserLevelGender(user?.gender);
    const id = Number(user?.id);

    if (!gender || !Number.isFinite(id) || id <= 0) {
      return {
        ...user,
        userLevel: null,
      };
    }

    const configRows =
      gender === USER_LEVEL_GENDERS.FEMALE ? femaleConfig : maleConfig;
    const coinsMap =
      gender === USER_LEVEL_GENDERS.FEMALE ? femaleCoins : maleCoins;

    try {
      return {
        ...user,
        userLevel: toCardUserLevel(
          resolveLevelFromEligibleCoins(coinsMap.get(id) ?? 0, configRows)
        ),
      };
    } catch (error) {
      console.log("USER LEVEL BATCH RESOLVE ERROR", id, error.message);
      return {
        ...user,
        userLevel: null,
      };
    }
  });
};

export const updateLevelConfig = async (gender, rows) => {
  await ensureUserLevelSchema();

  const normalizedGender = normalizeUserLevelGender(gender);
  const validation = validateLevelConfigRows(rows, normalizedGender);

  if (!validation.valid) {
    const error = new Error(validation.message);
    error.statusCode = 400;
    throw error;
  }

  const sortedRows = [...rows].sort(
    (a, b) => Number(a.levelNumber) - Number(b.levelNumber)
  );

  await sequelize.transaction(async (transaction) => {
    for (const row of sortedRows) {
      await sequelize.query(
        `UPDATE ${USER_LEVEL_CONFIG_TABLE}
         SET tier = :tier,
             minimumCoins = :minimumCoins,
             displayName = :displayName,
             theme = :theme,
             visualHeight = :visualHeight,
             badgeIcon = :badgeIcon,
             themeColor = :themeColor,
             isActive = :isActive,
             updatedAt = NOW()
         WHERE gender = :gender
           AND levelNumber = :levelNumber`,
        {
          replacements: {
            gender: normalizedGender,
            levelNumber: Number(row.levelNumber),
            tier: normalizeUserLevelTier(row.tier),
            minimumCoins: toNumber(row.minimumCoins),
            displayName: String(row.displayName).trim(),
            theme: String(row.theme).trim(),
            visualHeight: Number(row.visualHeight),
            badgeIcon: row.badgeIcon ? String(row.badgeIcon).trim() : null,
            themeColor: row.themeColor ? String(row.themeColor).trim() : null,
            isActive: row.isActive === false || row.isActive === 0 ? 0 : 1,
          },
          transaction,
        }
      );
    }
  });

  invalidateLevelConfigCache(normalizedGender);

  return getLevelConfig(normalizedGender);
};

export const getTierOptions = () => [...USER_LEVEL_TIERS];

/**
 * Refund limitation:
 * Male level counts payment_orders with successful statuses only.
 * If a refund does not update payment_orders.status away from a successful
 * status, that recharge may still count toward level until payment handling
 * is extended — existing payment flows are intentionally unchanged.
 */
