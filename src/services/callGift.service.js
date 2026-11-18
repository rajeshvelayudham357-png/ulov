import { Op, QueryTypes } from "sequelize";

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
import {
  istDateKeyToUtcRange,
  toIstDateKey,
} from "./adminRevenueTime.service.js";

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

export const fetchFemaleReceivedGiftSummary = async ({
  receiverId,
  excludeUserIds = [],
} = {}) => {
  const normalizedReceiverId = Number(receiverId);

  if (!Number.isFinite(normalizedReceiverId)) {
    throw new Error("Invalid user");
  }

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

  const rows = await CallGiftRecord.findAll({
    where,
    attributes: [
      "giftId",
      [sequelize.fn("MAX", sequelize.col("giftTitle")), "giftTitle"],
      [sequelize.fn("MAX", sequelize.col("giftEmoji")), "giftEmoji"],
      [sequelize.fn("COUNT", sequelize.col("id")), "count"],
      [sequelize.fn("SUM", sequelize.col("femaleCoins")), "coinsEarned"],
    ],
    group: ["giftId"],
    order: [[sequelize.fn("COUNT", sequelize.col("id")), "DESC"]],
    raw: true,
  });

  const gifts = rows.map((row) => {
    const catalogGift = getCallGiftById(String(row.giftId ?? ""));
    const count = Number(row.count) || 0;

    return {
      giftId: String(row.giftId ?? ""),
      giftTitle: row.giftTitle || catalogGift?.title || "Gift",
      giftEmoji: row.giftEmoji || catalogGift?.emoji || "🎁",
      count,
      coinsEarned: Number(row.coinsEarned) || 0,
    };
  });

  const totalGifts = gifts.reduce((sum, gift) => sum + gift.count, 0);
  const totalCoinsEarned = gifts.reduce(
    (sum, gift) => sum + gift.coinsEarned,
    0
  );

  return {
    gifts,
    totalGifts,
    summary: {
      totalGifts,
      totalCoinsEarned,
    },
  };
};

const resolveGiftUserName = (row, prefix) =>
  row[`${prefix}Nickname`] ||
  (row[`${prefix}Name`] && row[`${prefix}Name`] !== "New User"
    ? row[`${prefix}Name`]
    : null) ||
  row[`${prefix}Username`] ||
  row[`${prefix}PublicUserId`] ||
  row[`${prefix}Phone`] ||
  `User ${row[`${prefix}Id`]}`;

/**
 * Admin gift review: male → female call gifts for a given IST day.
 */
export const listAdminGiftReviews = async ({
  date,
  search = "",
  giftId = "",
  limit = 500,
} = {}) => {
  const reviewDate = String(date || toIstDateKey(new Date())).trim();
  const { start, end } = istDateKeyToUtcRange(reviewDate);
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const normalizedGiftId = String(giftId || "").trim();

  const whereParts = [
    "g.createdAt >= :startUtc",
    "g.createdAt <= :endUtc",
    "LOWER(TRIM(s.gender)) IN ('male', 'm')",
    "LOWER(TRIM(r.gender)) IN ('female', 'f')",
  ];
  const replacements = {
    startUtc: start,
    endUtc: end,
    limit: safeLimit,
  };

  if (normalizedGiftId) {
    whereParts.push("g.giftId = :giftId");
    replacements.giftId = normalizedGiftId;
  }

  const rows = await sequelize.query(
    `SELECT
       g.id,
       g.senderId,
       g.receiverId,
       g.giftId,
       g.giftTitle,
       g.giftEmoji,
       g.coinCost,
       g.femaleCoins,
       g.femaleAmount,
       g.callSessionId,
       g.createdAt,
       s.name AS senderName,
       s.nickname AS senderNickname,
       s.username AS senderUsername,
       s.phone AS senderPhone,
       s.publicUserId AS senderPublicUserId,
       r.name AS receiverName,
       r.nickname AS receiverNickname,
       r.username AS receiverUsername,
       r.phone AS receiverPhone,
       r.publicUserId AS receiverPublicUserId
     FROM call_gift_records g
     JOIN users s ON s.id = g.senderId
     JOIN users r ON r.id = g.receiverId
     WHERE ${whereParts.join(" AND ")}
     ORDER BY g.createdAt DESC
     LIMIT :limit`,
    {
      replacements,
      type: QueryTypes.SELECT,
    }
  );

  let mapped = rows.map((row) => ({
    id: Number(row.id),
    senderId: Number(row.senderId),
    senderName: resolveGiftUserName(row, "sender"),
    senderPhone: row.senderPhone || "—",
    senderPublicUserId: row.senderPublicUserId || "",
    receiverId: Number(row.receiverId),
    receiverName: resolveGiftUserName(row, "receiver"),
    receiverPhone: row.receiverPhone || "—",
    receiverPublicUserId: row.receiverPublicUserId || "",
    giftId: row.giftId,
    giftTitle: row.giftTitle || row.giftId,
    giftEmoji: row.giftEmoji || "🎁",
    coinCost: Number(row.coinCost) || 0,
    femaleCoins: Number(row.femaleCoins) || 0,
    femaleAmount: Number(row.femaleAmount) || 0,
    callSessionId: row.callSessionId ? Number(row.callSessionId) : null,
    sentAt: row.createdAt,
  }));

  if (search) {
    const query = String(search).toLowerCase();
    const compact = query.replace(/[^a-z0-9]/g, "");

    mapped = mapped.filter((row) => {
      const values = [
        row.senderName,
        row.senderPhone,
        row.senderPublicUserId,
        row.receiverName,
        row.receiverPhone,
        row.receiverPublicUserId,
        row.giftId,
        row.giftTitle,
        String(row.senderId),
        String(row.receiverId),
        row.callSessionId ? String(row.callSessionId) : "",
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return values.some((value) => {
        const compactValue = value.replace(/[^a-z0-9]/g, "");
        return (
          value.includes(query) ||
          (compact && compactValue.includes(compact))
        );
      });
    });
  }

  const uniqueSenders = new Set(mapped.map((row) => row.senderId)).size;
  const uniqueReceivers = new Set(mapped.map((row) => row.receiverId)).size;
  const totalCoinsSpent = mapped.reduce(
    (sum, row) => sum + Number(row.coinCost || 0),
    0
  );
  const totalFemaleCoins = mapped.reduce(
    (sum, row) => sum + Number(row.femaleCoins || 0),
    0
  );

  return {
    summary: {
      totalGifts: mapped.length,
      uniqueSenders,
      uniqueReceivers,
      totalCoinsSpent,
      totalFemaleCoins,
      reviewDate,
      giftId: normalizedGiftId || null,
    },
    gifts: CALL_GIFTS.map((gift) => ({
      id: gift.id,
      title: gift.title,
      emoji: gift.emoji,
      coins: gift.coins,
    })),
    rows: mapped,
  };
};
