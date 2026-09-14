import { Op } from "sequelize";

import { getCallGiftById, CALL_GIFTS } from "../constants/callGifts.js";
import { sequelize } from "../config/database.js";
import {
  ACTIVE_BATTLE_FIGHTER_STATUSES,
  BATTLE_ROOM_STATUSES,
} from "../constants/battle.js";
import {
  BattleAudienceSession,
  BattleFighter,
  BattleGiftRecord,
  BattleRoom,
  Earning,
  User,
  Wallet,
  WalletTransaction,
} from "../models/index.js";
import {
  calculateFemaleGiftEarn,
  getGiftSettings,
} from "./giftSettings.service.js";
import { areUsersBlocked } from "./block.service.js";
import { assertBattleFeatureEnabled } from "./battle.service.js";
import { ensureBattleSchema } from "./battleSchema.service.js";
import {
  emitBattleGiftSent,
  emitBattleScore,
} from "./battleRealtime.service.js";
import { finalizeExpiredLiveBattles } from "./battle.service.js";

const getDisplayName = (user) => {
  const nickname = user?.nickname?.trim();
  const name = user?.name?.trim();
  const username = user?.username?.trim();

  return (
    [nickname, name, username].find(
      (value) => value && value !== "New User"
    ) || "User"
  );
};

export const listBattleGiftsCatalog = async () => {
  const { femaleEarnPercent } = await getGiftSettings();

  return CALL_GIFTS.map((gift) => ({
    ...gift,
    femaleEarnCoins: calculateFemaleGiftEarn(gift.coins, femaleEarnPercent),
  }));
};

const getActiveAudienceSession = async (battleId, userId) =>
  BattleAudienceSession.findOne({
    where: {
      battleId: Number(battleId),
      userId: Number(userId),
      status: {
        [Op.in]: ["joining", "connected"],
      },
    },
  });

export const sendBattleGift = async ({
  senderId,
  battleId,
  receiverId,
  giftId,
  clientRequestId = null,
}) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();
  await finalizeExpiredLiveBattles();

  const gift = getCallGiftById(giftId);

  if (!gift) {
    throw new Error("Invalid gift");
  }

  const normalizedBattleId = Number(battleId);
  const normalizedSenderId = Number(senderId);
  const normalizedReceiverId = Number(receiverId);

  if (!Number.isFinite(normalizedReceiverId) || normalizedReceiverId <= 0) {
    throw new Error("Invalid receiver");
  }

  if (normalizedSenderId === normalizedReceiverId) {
    throw new Error("You cannot send a gift to yourself");
  }

  if (clientRequestId) {
    const existing = await BattleGiftRecord.findOne({
      where: { clientRequestId: String(clientRequestId).trim() },
    });

    if (existing) {
      const battle = await BattleRoom.findByPk(existing.battleId);
      const fighter = await BattleFighter.findOne({
        where: {
          battleId: existing.battleId,
          userId: existing.receiverId,
        },
      });

      return {
        id: existing.id,
        battleId: existing.battleId,
        duplicate: true,
        giftId: existing.giftId,
        giftTitle: existing.giftTitle,
        giftEmoji: existing.giftEmoji,
        coinCost: existing.coinCost,
        femaleCoins: existing.femaleCoins,
        femaleAmount: existing.femaleAmount,
        receiver: {
          id: existing.receiverId,
          fighterSlot: existing.fighterSlot,
        },
        battleStatus: battle?.status ?? null,
        fighterScore: fighter ? Number(fighter.scoreCoins) : 0,
      };
    }
  }

  const battle = await BattleRoom.findByPk(normalizedBattleId);

  if (!battle) {
    throw new Error("Battle not found");
  }

  if (battle.status !== BATTLE_ROOM_STATUSES.LIVE) {
    throw new Error("Battle is not live");
  }

  const now = new Date();

  if (!battle.startsAt || !battle.endsAt) {
    throw new Error("Battle timer is not active");
  }

  if (now < new Date(battle.startsAt) || now >= new Date(battle.endsAt)) {
    throw new Error("Gift window has closed for this battle");
  }

  const audienceSession = await getActiveAudienceSession(
    normalizedBattleId,
    normalizedSenderId
  );

  if (!audienceSession) {
    throw new Error("Battle audience membership required");
  }

  const fighter = await BattleFighter.findOne({
    where: {
      battleId: normalizedBattleId,
      userId: normalizedReceiverId,
      status: {
        [Op.in]: ACTIVE_BATTLE_FIGHTER_STATUSES,
      },
    },
  });

  if (!fighter) {
    throw new Error("Receiver is not an active fighter in this battle");
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
    throw new Error("Only male users can send battle gifts");
  }

  if (receiverGender !== "female") {
    throw new Error("Gifts can only be sent to female fighters");
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
        description: `Battle gift: ${gift.title} → ${getDisplayName(receiver)}`,
        referenceType: "battle_gift",
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

    const record = await BattleGiftRecord.create(
      {
        battleId: normalizedBattleId,
        senderId: normalizedSenderId,
        receiverId: normalizedReceiverId,
        fighterSlot: fighter.slot,
        giftId: gift.id,
        giftTitle: gift.title,
        giftEmoji: gift.emoji ?? null,
        coinCost,
        femaleCoins,
        femaleAmount,
        clientRequestId: clientRequestId
          ? String(clientRequestId).trim()
          : null,
      },
      { transaction }
    );

    await fighter.increment("scoreCoins", { by: coinCost, transaction });

    await transaction.commit();

    await fighter.reload();

    const payload = {
      id: record.id,
      battleId: normalizedBattleId,
      giftId: gift.id,
      giftTitle: gift.title,
      giftEmoji: gift.emoji ?? null,
      coinCost,
      femaleCoins,
      femaleAmount,
      fighterSlot: fighter.slot,
      sender: {
        id: normalizedSenderId,
        displayName: getDisplayName(sender),
      },
      receiver: {
        id: normalizedReceiverId,
        displayName: getDisplayName(receiver),
        fighterSlot: fighter.slot,
      },
      scores: {
        A:
          fighter.slot === "A"
            ? Number(fighter.scoreCoins)
            : undefined,
        B:
          fighter.slot === "B"
            ? Number(fighter.scoreCoins)
            : undefined,
      },
      wallet: {
        balance: senderWallet.balance,
      },
    };

    if (fighter.slot === "A") {
      const fighterB = await BattleFighter.findOne({
        where: { battleId: normalizedBattleId, slot: "B" },
      });
      payload.scores = {
        A: Number(fighter.scoreCoins),
        B: Number(fighterB?.scoreCoins || 0),
      };
    } else {
      const fighterA = await BattleFighter.findOne({
        where: { battleId: normalizedBattleId, slot: "A" },
      });
      payload.scores = {
        A: Number(fighterA?.scoreCoins || 0),
        B: Number(fighter.scoreCoins),
      };
    }

    emitBattleGiftSent(normalizedBattleId, payload);
    emitBattleScore(normalizedBattleId, {
      battleId: normalizedBattleId,
      scores: payload.scores,
    });

    return payload;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
