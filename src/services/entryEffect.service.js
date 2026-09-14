import { sequelize } from "../config/database.js";
import {
  DEFAULT_MALE_ENTRY_EFFECTS,
  ENTRY_EFFECT_PRICES,
  getEnabledEntryEffect,
  normalizeEntryEffectId,
} from "../constants/entryEffects.js";
import { User, Wallet, WalletTransaction } from "../models/index.js";

export const parsePurchasedEntryEffectIds = (user) => {
  const raw = user?.purchasedEntryEffectIds;

  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => normalizeEntryEffectId(item))
      .filter(Boolean);
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => normalizeEntryEffectId(item))
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  return [];
};

export const getEntryEffectPrice = (effectId) => {
  const normalizedId = normalizeEntryEffectId(effectId);

  if (!normalizedId) {
    return 0;
  }

  const match = getEnabledEntryEffect(
    DEFAULT_MALE_ENTRY_EFFECTS,
    normalizedId
  );

  if (match?.priceCoins != null) {
    return Number(match.priceCoins) || 0;
  }

  return Number(ENTRY_EFFECT_PRICES[normalizedId]) || 0;
};

export const isEntryEffectOwned = (user, effectId) => {
  const normalizedId = normalizeEntryEffectId(effectId);

  if (!normalizedId) {
    return true;
  }

  const ownedIds = parsePurchasedEntryEffectIds(user);

  return ownedIds.includes(normalizedId);
};

export const resolveVisibleEntryEffectId = (user) => {
  const selectedId = normalizeEntryEffectId(user?.entryEffectId);

  if (!selectedId) {
    return null;
  }

  if (!isEntryEffectOwned(user, selectedId)) {
    return null;
  }

  return selectedId;
};

export const buildEntryEffectsCatalog = (user) =>
  DEFAULT_MALE_ENTRY_EFFECTS.filter((item) => item.enabled !== false).map(
    (item) => {
      const owned =
        item.id === "none" || isEntryEffectOwned(user, item.id);
      const priceCoins =
        item.id === "none" ? 0 : getEntryEffectPrice(item.id);

      return {
        id: item.id,
        label: item.label,
        previewEmoji: item.previewEmoji,
        enabled: item.enabled !== false,
        priceCoins,
        owned,
        locked: !owned && item.id !== "none",
      };
    }
  );

export const validateEntryEffectSelection = (effectId, user) => {
  const normalizedId = normalizeEntryEffectId(effectId);

  if (!normalizedId) {
    return { valid: true, entryEffectId: null };
  }

  const match = getEnabledEntryEffect(DEFAULT_MALE_ENTRY_EFFECTS, normalizedId);

  if (!match) {
    return {
      valid: false,
      message: "Selected entry effect is not available",
    };
  }

  if (user && !isEntryEffectOwned(user, normalizedId)) {
    return {
      valid: false,
      message: "Purchase this entry effect to unlock it",
    };
  }

  return {
    valid: true,
    entryEffectId: match.id,
  };
};

export const purchaseEntryEffect = async (userId, effectId) => {
  const normalizedId = normalizeEntryEffectId(effectId);

  if (!normalizedId) {
    throw new Error("Invalid entry effect");
  }

  const match = getEnabledEntryEffect(DEFAULT_MALE_ENTRY_EFFECTS, normalizedId);

  if (!match) {
    throw new Error("Selected entry effect is not available");
  }

  const priceCoins = getEntryEffectPrice(normalizedId);

  if (priceCoins <= 0) {
    throw new Error("This entry effect cannot be purchased");
  }

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
      throw new Error("Entry effects are only available for male profiles");
    }

    const ownedIds = parsePurchasedEntryEffectIds(user);

    if (ownedIds.includes(normalizedId)) {
      await transaction.commit();

      return {
        effectId: match.id,
        purchasedEntryEffectIds: ownedIds,
        alreadyOwned: true,
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

    if (currentBalance < priceCoins) {
      throw new Error("Insufficient gold balance");
    }

    wallet.balance = currentBalance - priceCoins;
    await wallet.save({ transaction });

    await WalletTransaction.create(
      {
        userId,
        type: "debit",
        amount: priceCoins,
        description: `Entry effect: ${match.label}`,
        referenceType: "entry_effect",
      },
      { transaction }
    );

    const nextOwnedIds = [...ownedIds, normalizedId];

    await user.update(
      {
        purchasedEntryEffectIds: nextOwnedIds,
      },
      { transaction }
    );

    await transaction.commit();

    return {
      effectId: match.id,
      purchasedEntryEffectIds: nextOwnedIds,
      balance: wallet.balance,
      priceCoins,
      alreadyOwned: false,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
