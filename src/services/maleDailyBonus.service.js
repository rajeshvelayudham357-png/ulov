import { User, Wallet, WalletTransaction } from "../models/index.js";
import { sequelize } from "../config/database.js";
import { getAppSettings } from "./appSettings.service.js";
import { ensureColumn } from "./schemaUtil.service.js";

export const MALE_DAILY_BONUS_NEW_USER_DAYS = 14;
export const INDIA_TIME_ZONE = "Asia/Kolkata";

let claimedOnReady = false;

export const getIndiaDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

const normalizeClaimedOn = (value) => {
  if (!value) {
    return null;
  }

  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

const isMaleUser = (user) =>
  String(user?.gender || "").trim().toLowerCase() === "male";

const isNewMaleUser = (user, now = Date.now()) => {
  const createdMs = new Date(user.createdAt).getTime();

  if (!Number.isFinite(createdMs)) {
    return true;
  }

  return now - createdMs <= MALE_DAILY_BONUS_NEW_USER_DAYS * 24 * 60 * 60 * 1000;
};

export const ensureMaleDailyBonusSchema = async () => {
  if (claimedOnReady) {
    return;
  }

  await ensureColumn(
    "users",
    "maleDailyBonusClaimedOn",
    "VARCHAR(10) NULL"
  );
  claimedOnReady = true;
};

const getConfig = (settings) => ({
  enabled: Boolean(settings.maleDailyBonusEnabled),
  coins: Number(settings.maleDailyBonusCoins) || 10,
  audience: settings.maleDailyBonusAudience === "all" ? "all" : "new",
});

export const getMaleDailyBonusEligibility = async (userId) => {
  await ensureMaleDailyBonusSchema();

  const settings = await getAppSettings();
  const config = getConfig(settings);
  const today = getIndiaDate();
  const numericUserId = Number(userId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    return {
      ...config,
      eligible: false,
      claimedToday: false,
      claimDate: today,
      reason: "invalid_user",
    };
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "gender", "createdAt", "maleDailyBonusClaimedOn"],
  });

  if (!user || !isMaleUser(user)) {
    return {
      ...config,
      eligible: false,
      claimedToday: false,
      claimDate: today,
      reason: "not_male",
    };
  }

  const claimedOn = normalizeClaimedOn(user.maleDailyBonusClaimedOn);
  const claimedToday = claimedOn === today;

  if (!config.enabled) {
    return {
      ...config,
      eligible: false,
      claimedToday,
      claimDate: today,
      reason: "disabled",
    };
  }

  if (!Number.isFinite(config.coins) || config.coins <= 0) {
    return {
      ...config,
      eligible: false,
      claimedToday,
      claimDate: today,
      reason: "invalid_coins",
    };
  }

  if (config.audience !== "all" && !isNewMaleUser(user)) {
    return {
      ...config,
      eligible: false,
      claimedToday,
      claimDate: today,
      reason: "not_new",
    };
  }

  if (claimedToday) {
    return {
      ...config,
      eligible: false,
      claimedToday: true,
      claimDate: today,
      reason: "already_claimed_today",
    };
  }

  return {
    ...config,
    eligible: true,
    claimedToday: false,
    claimDate: today,
    reason: null,
  };
};

export const claimMaleDailyBonus = async (userId) => {
  await ensureMaleDailyBonusSchema();

  const transaction = await sequelize.transaction();

  try {
    const settings = await getAppSettings();
    const config = getConfig(settings);
    const today = getIndiaDate();
    const numericUserId = Number(userId);

    if (!config.enabled) {
      throw new Error("Daily bonus is currently disabled");
    }

    if (!Number.isFinite(config.coins) || config.coins <= 0) {
      throw new Error("Daily bonus coins are not configured");
    }

    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      throw new Error("Valid user id is required");
    }

    const user = await User.findByPk(numericUserId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!user || !isMaleUser(user)) {
      throw new Error("Daily bonus is available for male users only");
    }

    if (config.audience !== "all" && !isNewMaleUser(user)) {
      throw new Error("Daily bonus is available for new male users only");
    }

    const claimedOn = normalizeClaimedOn(user.maleDailyBonusClaimedOn);

    if (claimedOn === today) {
      throw new Error("Daily bonus already claimed today");
    }

    let wallet = await Wallet.findOne({
      where: { userId: numericUserId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!wallet) {
      wallet = await Wallet.create(
        {
          userId: numericUserId,
          balance: 0,
        },
        { transaction }
      );
    }

    wallet.balance = Number(wallet.balance) + config.coins;
    await wallet.save({ transaction });

    await WalletTransaction.create(
      {
        userId: numericUserId,
        type: "credit",
        amount: config.coins,
        description: "Daily bonus",
        referenceType: "male_daily_bonus",
      },
      { transaction }
    );

    user.maleDailyBonusClaimedOn = today;
    await user.save({ transaction });

    await transaction.commit();

    return {
      coins: config.coins,
      walletBalance: Number(wallet.balance),
      claimedToday: true,
      claimDate: today,
      message: `Daily bonus of ${config.coins} coins added to your wallet`,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
