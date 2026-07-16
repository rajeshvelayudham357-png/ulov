import { Op } from "sequelize";

import {
  CALL_GIFTS,
  getCallGiftById,
} from "../constants/callGifts.js";
import { sequelize } from "../config/database.js";
import {
  calculateFemaleGiftEarn,
  getGiftSettings,
} from "./giftSettings.service.js";
import {
  CallGiftRecord,
  Earning,
  User,
  Wallet,
  WalletTransaction,
} from "../models/index.js";
import { areUsersBlocked, getBlockedPeerIds } from "./block.service.js";

const getDisplayName = (user) => {
  const name = user?.name?.trim();
  const username = user?.username?.trim();

  if (name && name !== "New User") {
    return name;
  }

  if (username) {
    return username;
  }

  return name || "User";
};

export const listCallGifts = async () => {
  const { femaleEarnPercent } = await getGiftSettings();

  return CALL_GIFTS.map((gift) => ({
    ...gift,
    femaleEarnCoins: calculateFemaleGiftEarn(gift.coins, femaleEarnPercent),
  }));
};

export const sendCallGift = async ({
  senderId,
  receiverId,
  giftId,
  callSessionId,
}) => {
  const gift = getCallGiftById(giftId);

  if (!gift) {
    throw new Error("Invalid gift");
  }

  const normalizedSenderId = Number(senderId);
  const normalizedReceiverId = Number(receiverId);

  if (
    !Number.isFinite(normalizedSenderId) ||
    !Number.isFinite(normalizedReceiverId)
  ) {
    throw new Error("Invalid users");
  }

  const [sender, receiver] = await Promise.all([
    User.findByPk(normalizedSenderId),
    User.findByPk(normalizedReceiverId),
  ]);

  if (!sender || !receiver) {
    throw new Error("User not found");
  }

  const senderGender = String(sender.gender || "").toLowerCase();
  const receiverGender = String(receiver.gender || "").toLowerCase();

  if (senderGender !== "male") {
    throw new Error("Only male users can send call gifts");
  }

  if (receiverGender !== "female") {
    throw new Error("Gifts can only be sent to female creators");
  }

  if (await areUsersBlocked(normalizedSenderId, normalizedReceiverId)) {
    throw new Error("Unable to send gift to this user");
  }

  const coinCost = Number(gift.coins);

  if (!Number.isFinite(coinCost) || coinCost <= 0) {
    throw new Error("Invalid gift amount");
  }

  const { femaleEarnPercent } = await getGiftSettings();
  const femaleCoins = calculateFemaleGiftEarn(coinCost, femaleEarnPercent);
  const femaleAmount = femaleCoins / 2;

  const transaction = await sequelize.transaction();

  try {
    let senderWallet = await Wallet.findOne({
      where: { userId: normalizedSenderId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!senderWallet) {
      senderWallet = await Wallet.create(
        {
          userId: normalizedSenderId,
          balance: 0,
        },
        { transaction }
      );
    }

    const currentBalance = Number(senderWallet.balance || 0);

    if (currentBalance < coinCost) {
      throw new Error("Insufficient gold balance");
    }

    senderWallet.balance = currentBalance - coinCost;
    await senderWallet.save({ transaction });

    await WalletTransaction.create(
      {
        userId: normalizedSenderId,
        type: "debit",
        amount: coinCost,
        description: `Call gift: ${gift.title} → ${getDisplayName(receiver)}`,
      },
      { transaction }
    );

    if (femaleCoins > 0) {
      await Earning.create(
        {
          userId: normalizedReceiverId,
          callId: null,
          coins: femaleCoins,
          amount: femaleAmount,
          duration: 0,
          status: "pending",
        },
        { transaction }
      );
    }

    await CallGiftRecord.create(
      {
        senderId: normalizedSenderId,
        receiverId: normalizedReceiverId,
        giftId: gift.id,
        giftTitle: gift.title,
        giftEmoji: gift.emoji ?? null,
        coinCost,
        femaleCoins,
        femaleAmount,
        callSessionId: callSessionId ? Number(callSessionId) : null,
      },
      { transaction }
    );

    await transaction.commit();

    return {
      gift,
      coinCost,
      femaleCoins,
      femaleAmount,
      femaleEarnPercent,
      callSessionId: callSessionId ? Number(callSessionId) : null,
      sender: {
        id: normalizedSenderId,
        displayName: getDisplayName(sender),
      },
      receiver: {
        id: normalizedReceiverId,
        displayName: getDisplayName(receiver),
      },
      wallet: {
        balance: senderWallet.balance,
      },
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const fetchFemaleReceivedGifts = async ({
  receiverId,
  page = 1,
  limit = 20,
  excludeUserIds = [],
} = {}) => {
  const normalizedReceiverId = Number(receiverId);

  if (!Number.isFinite(normalizedReceiverId)) {
    throw new Error("Invalid user");
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const offset = (safePage - 1) * safeLimit;

  const excludeSource =
    excludeUserIds instanceof Set
      ? [...excludeUserIds]
      : Array.isArray(excludeUserIds)
        ? excludeUserIds
        : [];

  const excludeIds = excludeSource
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const where = {
    receiverId: normalizedReceiverId,
  };

  if (excludeIds.length > 0) {
    where.senderId = {
      [Op.notIn]: excludeIds,
    };
  }

  const { rows, count } = await CallGiftRecord.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: "sender",
        required: true,
        attributes: [
          "id",
          "username",
          "name",
          "nickname",
          "avatar",
          "online",
          "verified",
        ],
      },
    ],
    order: [["createdAt", "DESC"]],
    limit: safeLimit,
    offset,
  });

  const gifts = rows.map((row) => {
    const data = row.toJSON();
    const sender = data.sender ?? {};

    return {
      id: Number(data.id),
      giftId: data.giftId,
      giftTitle: data.giftTitle,
      giftEmoji: data.giftEmoji,
      coinCost: Number(data.coinCost || 0),
      femaleCoins: Number(data.femaleCoins || 0),
      femaleAmount: Number(data.femaleAmount || 0),
      callSessionId: data.callSessionId ? Number(data.callSessionId) : null,
      receivedAt: data.createdAt,
      sender: {
        id: Number(sender.id),
        username: sender.username,
        name: sender.name,
        nickname: sender.nickname,
        avatar: sender.avatar,
        online: Boolean(sender.online),
        verified: Boolean(sender.verified),
        displayName: getDisplayName(sender),
      },
    };
  });

  const totalCoinsEarned =
    Number(
      await CallGiftRecord.sum("femaleCoins", {
        where,
      })
    ) || 0;

  return {
    gifts,
    total: count,
    page: safePage,
    limit: safeLimit,
    hasMore: offset + gifts.length < count,
    summary: {
      totalGifts: count,
      totalCoinsEarned,
    },
  };
};
