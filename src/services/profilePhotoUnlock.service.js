import { sequelize } from "../config/database.js";
import {
  PROFILE_PHOTO_UNLOCK_COINS,
} from "../constants/profilePhoto.js";
import { User, Wallet, WalletTransaction } from "../models/index.js";

export const purchaseProfilePhotoUnlock = async (userId) => {
  const transaction = await sequelize.transaction();

  try {
    const user = await User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (String(user.gender ?? "").toLowerCase() !== "male") {
      throw new Error("Photo unlock purchase is only available for male profiles");
    }

    if (Boolean(user.profilePhotoUnlocked)) {
      await transaction.commit();

      return {
        alreadyUnlocked: true,
        profilePhotoUnlocked: true,
      };
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

    const currentBalance = Number(wallet.balance) || 0;

    if (currentBalance < PROFILE_PHOTO_UNLOCK_COINS) {
      const error = new Error("Insufficient gold balance");
      error.statusCode = 400;
      throw error;
    }

    wallet.balance = currentBalance - PROFILE_PHOTO_UNLOCK_COINS;
    await wallet.save({ transaction });

    await WalletTransaction.create(
      {
        userId,
        type: "debit",
        amount: PROFILE_PHOTO_UNLOCK_COINS,
        description: "Profile photo unlock",
        referenceType: "profile_photo_unlock",
      },
      { transaction }
    );

    await user.update(
      {
        profilePhotoUnlocked: true,
      },
      { transaction }
    );

    await transaction.commit();

    return {
      alreadyUnlocked: false,
      profilePhotoUnlocked: true,
      balance: wallet.balance,
      priceCoins: PROFILE_PHOTO_UNLOCK_COINS,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
