import { getCallGiftById, CALL_GIFTS } from "../constants/callGifts.js";
import { sequelize } from "../config/database.js";
import {
  Earning,
  User,
  VoiceRoomGiftRecord,
  Wallet,
  WalletTransaction,
} from "../models/index.js";
import {
  calculateFemaleGiftEarn,
  getGiftSettings,
} from "./giftSettings.service.js";
import { areUsersBlocked } from "./block.service.js";
import {
  getActiveVoiceRoomMember,
  getActiveVoiceRoomParticipation,
} from "./voiceRoomMembership.service.js";
import { emitVoiceRoomGiftSent } from "./voiceRoomRealtime.service.js";

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

export const listVoiceRoomGiftsCatalog = async () => {
  const { femaleEarnPercent } = await getGiftSettings();

  return CALL_GIFTS.map((gift) => ({
    ...gift,
    femaleEarnCoins: calculateFemaleGiftEarn(gift.coins, femaleEarnPercent),
  }));
};

export const sendVoiceRoomGift = async ({
  senderId,
  roomId,
  receiverId,
  giftId,
}) => {
  const gift = getCallGiftById(giftId);

  if (!gift) {
    throw new Error("Invalid gift");
  }

  const { room, liveSession } = await getActiveVoiceRoomParticipation(
    senderId,
    roomId
  );

  const normalizedSenderId = Number(senderId);
  const normalizedReceiverId = Number(receiverId);

  if (!Number.isFinite(normalizedReceiverId) || normalizedReceiverId <= 0) {
    throw new Error("Invalid receiver");
  }

  if (normalizedSenderId === normalizedReceiverId) {
    throw new Error("You cannot send a gift to yourself");
  }

  const receiverMembership = await getActiveVoiceRoomMember(
    room.id,
    liveSession.id,
    normalizedReceiverId
  );

  if (!receiverMembership) {
    throw new Error("Receiver is not an active member of this voice room");
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
    throw new Error("Only male users can send gifts in voice rooms");
  }

  if (receiverGender !== "female") {
    throw new Error("Gifts can only be sent to female participants");
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
        description: `Voice room gift: ${gift.title} → ${getDisplayName(receiver)}`,
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

    const record = await VoiceRoomGiftRecord.create(
      {
        roomId: room.id,
        sessionId: liveSession.id,
        senderId: normalizedSenderId,
        receiverId: normalizedReceiverId,
        giftId: gift.id,
        giftTitle: gift.title,
        giftEmoji: gift.emoji ?? null,
        coinCost,
        femaleCoins,
        femaleAmount,
      },
      { transaction }
    );

    await transaction.commit();

    const payload = {
      id: record.id,
      roomId: room.id,
      sessionId: liveSession.id,
      giftId: gift.id,
      giftTitle: gift.title,
      giftEmoji: gift.emoji ?? null,
      coinCost,
      femaleCoins,
      femaleAmount,
      sender: {
        id: normalizedSenderId,
        displayName: getDisplayName(sender),
      },
      receiver: {
        id: normalizedReceiverId,
        displayName: getDisplayName(receiver),
        seatIndex: receiverMembership.seatIndex,
      },
      wallet: {
        balance: senderWallet.balance,
      },
    };

    emitVoiceRoomGiftSent(room.id, payload);

    return payload;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
