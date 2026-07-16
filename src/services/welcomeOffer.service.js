import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { User, Wallet, WalletTransaction } from "../models/index.js";
import { getAppSettings } from "./appSettings.service.js";

export const getWelcomeOfferPublicConfig = async () => {
  const settings = await getAppSettings();

  return {
    enabled: settings.welcomeOfferEnabled,
    coins: settings.welcomeOfferCoins,
    updatedAt: settings.updatedAt || null,
  };
};

export const getWelcomeOfferEligibility = async (userId) => {
  const settings = await getAppSettings();
  const config = {
    enabled: settings.welcomeOfferEnabled,
    coins: settings.welcomeOfferCoins,
  };

  const user = await User.findByPk(userId, {
    attributes: [
      "id",
      "gender",
      "profileCompleted",
      "welcomeOfferClaimed",
    ],
  });

  if (!user) {
    return {
      ...config,
      eligible: false,
      reason: "user_not_found",
      welcomeOfferClaimed: false,
    };
  }

  const welcomeOfferClaimed = Boolean(user.welcomeOfferClaimed);

  if (!settings.welcomeOfferEnabled) {
    return {
      ...config,
      eligible: false,
      reason: "disabled",
      welcomeOfferClaimed,
    };
  }

  if (String(user.gender) !== "Male") {
    return {
      ...config,
      eligible: false,
      reason: "not_male",
      welcomeOfferClaimed,
    };
  }

  if (!user.profileCompleted) {
    return {
      ...config,
      eligible: false,
      reason: "profile_incomplete",
      welcomeOfferClaimed,
    };
  }

  if (welcomeOfferClaimed) {
    return {
      ...config,
      eligible: false,
      reason: "already_claimed",
      welcomeOfferClaimed: true,
    };
  }

  return {
    ...config,
    eligible: true,
    reason: null,
    welcomeOfferClaimed: false,
  };
};

export const claimWelcomeOffer = async (userId) => {
  const transaction = await sequelize.transaction();

  try {
    const settings = await getAppSettings();
    const coins = Number(settings.welcomeOfferCoins) || 0;

    if (!settings.welcomeOfferEnabled) {
      throw new Error("Welcome offer is currently disabled");
    }

    if (!Number.isFinite(coins) || coins <= 0) {
      throw new Error("Welcome offer coins are not configured");
    }

    const user = await User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (String(user.gender) !== "Male") {
      throw new Error("Welcome offer is available for male users only");
    }

    if (!user.profileCompleted) {
      throw new Error("Complete your profile before claiming the welcome offer");
    }

    if (user.welcomeOfferClaimed) {
      throw new Error("Welcome offer already claimed");
    }

    let wallet = await Wallet.findOne({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!wallet) {
      wallet = await Wallet.create(
        {
          userId,
          balance: 0,
        },
        { transaction }
      );
    }

    wallet.balance = Number(wallet.balance) + coins;
    await wallet.save({ transaction });

    await WalletTransaction.create(
      {
        userId,
        type: "credit",
        amount: coins,
        description: "Welcome offer bonus",
      },
      { transaction }
    );

    user.welcomeOfferClaimed = true;
    await user.save({ transaction });

    await transaction.commit();

    return {
      coins,
      walletBalance: Number(wallet.balance),
      welcomeOfferClaimed: true,
      message: `Welcome bonus of ${coins} coins added to your wallet`,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const ensureWelcomeOfferSchema = async () => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS columnCount
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME = 'users'
AND COLUMN_NAME = 'welcomeOfferClaimed'`,
    { type: QueryTypes.SELECT }
  );

  if (Number(rows[0]?.columnCount ?? 0) === 0) {
    await sequelize.query(
      "ALTER TABLE `users` ADD COLUMN `welcomeOfferClaimed` TINYINT(1) NOT NULL DEFAULT 0"
    );
  }
};
