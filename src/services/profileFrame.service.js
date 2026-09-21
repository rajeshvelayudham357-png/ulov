import { fn, col } from "sequelize";

import { sequelize } from "../config/database.js";
import { Earning, User } from "../models/index.js";
import { ensureColumn } from "./schemaUtil.service.js";
import {
  DEFAULT_PROFILE_FRAMES,
  getEnabledProfileFrame,
  normalizeProfileFrameId,
} from "../constants/profileFrames.js";

let columnsReady = false;

export const ensureProfileFrameSchema = async () => {
  if (columnsReady) {
    return;
  }

  await ensureColumn("users", "profileFrameId", "VARCHAR(64) NULL");
  await ensureColumn("users", "profileFrameExpiresAt", "DATETIME NULL");
  await ensureColumn("users", "purchasedProfileFrames", "JSON NULL");
  await ensureColumn(
    "users",
    "profileFrameSpentCoins",
    "INT NOT NULL DEFAULT 0"
  );
  columnsReady = true;
};

const addDays = (from, days) => {
  const next = new Date(from);
  next.setTime(next.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
  return next;
};

const toTime = (value) => {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

export const parsePurchasedProfileFrames = (value) => {
  let items = value;

  if (typeof items === "string" && items.trim()) {
    try {
      items = JSON.parse(items);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      const id = normalizeProfileFrameId(item?.id ?? item?.frameId ?? item);

      if (!id) {
        return null;
      }

      return {
        id,
        expiresAt: item?.expiresAt || item?.expires_at || null,
      };
    })
    .filter(Boolean);
};

export const getActivePurchasedFrame = (purchased, frameId, now = new Date()) => {
  const normalizedId = normalizeProfileFrameId(frameId);

  if (!normalizedId) {
    return null;
  }

  const match = purchased.find((item) => item.id === normalizedId);

  if (!match) {
    return null;
  }

  if (toTime(match.expiresAt) <= now.getTime()) {
    return null;
  }

  return match;
};

export const resolveVisibleProfileFrame = (user, now = new Date()) => {
  const purchased = parsePurchasedProfileFrames(user?.purchasedProfileFrames);
  const selectedId = normalizeProfileFrameId(user?.profileFrameId);
  const selectedExpiry = user?.profileFrameExpiresAt;
  const selected = selectedId
    ? getActivePurchasedFrame(
        [
          ...purchased,
          selectedExpiry
            ? { id: selectedId, expiresAt: selectedExpiry }
            : null,
        ].filter(Boolean),
        selectedId,
        now
      )
    : null;

  if (selected) {
    return {
      profileFrameId: selected.id,
      profileFrameExpiresAt: selected.expiresAt,
    };
  }

  const nextActive = purchased
    .filter((item) => toTime(item.expiresAt) > now.getTime())
    .sort((a, b) => toTime(b.expiresAt) - toTime(a.expiresAt))[0];

  if (!nextActive) {
    return {
      profileFrameId: null,
      profileFrameExpiresAt: null,
    };
  }

  return {
    profileFrameId: nextActive.id,
    profileFrameExpiresAt: nextActive.expiresAt,
  };
};

export const getFemaleGoldBalance = async (userId, spentCoins = 0) => {
  const row = await Earning.findOne({
    where: { userId },
    attributes: [[fn("COALESCE", fn("SUM", col("coins")), 0), "totalGold"]],
    raw: true,
  });

  const earned = Number(row?.totalGold) || 0;
  return Math.max(0, earned - (Number(spentCoins) || 0));
};

export const buildProfileFramesCatalog = async (user) => {
  await ensureProfileFrameSchema();

  const purchased = parsePurchasedProfileFrames(user?.purchasedProfileFrames);
  const visible = resolveVisibleProfileFrame(user);
  const goldBalance = await getFemaleGoldBalance(
    user.id,
    user.profileFrameSpentCoins
  );

  return {
    goldBalance,
    equippedFrameId: visible.profileFrameId,
    equippedExpiresAt: visible.profileFrameExpiresAt,
    frames: DEFAULT_PROFILE_FRAMES.filter((item) => item.enabled !== false).map(
      (item) => {
        const owned = getActivePurchasedFrame(purchased, item.id);

        return {
          id: item.id,
          label: item.label,
          durationDays: item.durationDays,
          priceCoins: item.priceCoins,
          owned: Boolean(owned),
          expiresAt: owned?.expiresAt || null,
          equipped: visible.profileFrameId === item.id,
        };
      }
    ),
  };
};

export const purchaseProfileFrame = async (userId, frameId) => {
  await ensureProfileFrameSchema();

  const match = getEnabledProfileFrame(frameId);

  if (!match) {
    throw new Error("This profile frame is not available");
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

    if (String(user.gender ?? "").toLowerCase() !== "female") {
      throw new Error("Profile frames are only available for female profiles");
    }

    const goldBalance = await getFemaleGoldBalance(
      userId,
      user.profileFrameSpentCoins
    );

    if (goldBalance < match.priceCoins) {
      throw new Error("Insufficient gold to purchase this frame");
    }

    const now = new Date();
    const purchased = parsePurchasedProfileFrames(user.purchasedProfileFrames);
    const existing = purchased.find((item) => item.id === match.id);
    const baseTime = Math.max(now.getTime(), toTime(existing?.expiresAt));
    const expiresAt = addDays(new Date(baseTime), match.durationDays);

    const nextPurchased = [
      ...purchased.filter((item) => item.id !== match.id),
      { id: match.id, expiresAt: expiresAt.toISOString() },
    ];

    await user.update(
      {
        profileFrameId: match.id,
        profileFrameExpiresAt: expiresAt,
        purchasedProfileFrames: nextPurchased,
        profileFrameSpentCoins:
          (Number(user.profileFrameSpentCoins) || 0) + match.priceCoins,
      },
      { transaction }
    );

    await transaction.commit();

    return {
      frameId: match.id,
      expiresAt,
      durationDays: match.durationDays,
      priceCoins: match.priceCoins,
      goldBalance: goldBalance - match.priceCoins,
      purchasedProfileFrames: nextPurchased,
      profileFrameId: match.id,
      profileFrameExpiresAt: expiresAt,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const equipProfileFrame = async (userId, frameId) => {
  await ensureProfileFrameSchema();

  const transaction = await sequelize.transaction();

  try {
    const user = await User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!user) {
      throw new Error("User not found");
    }

    const normalizedId = normalizeProfileFrameId(frameId);
    const purchased = parsePurchasedProfileFrames(user.purchasedProfileFrames);

    if (!normalizedId) {
      await user.update(
        {
          profileFrameId: null,
          profileFrameExpiresAt: null,
        },
        { transaction }
      );
      await transaction.commit();

      return {
        profileFrameId: null,
        profileFrameExpiresAt: null,
      };
    }

    const owned = getActivePurchasedFrame(purchased, normalizedId);

    if (!owned) {
      throw new Error("Purchase this frame to wear it");
    }

    await user.update(
      {
        profileFrameId: owned.id,
        profileFrameExpiresAt: owned.expiresAt,
      },
      { transaction }
    );

    await transaction.commit();

    return {
      profileFrameId: owned.id,
      profileFrameExpiresAt: owned.expiresAt,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
