import { Op } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  User,
  Earning,
  CallHistory,
  Wallet,
  PaymentOrder,
  WalletTransaction,
  Favorite,
  DeviceToken,
  NotificationRecord,
  ChatMessage,
  CallRating,
  Block,
  CallGiftRecord,
  AccountDeletionRequest,
  SupportTicket,
  SupportMessage,
  Kyc,
  Withdraw,
  UserOnlineLog,
  MaleScratchRewardClaim,
  FemaleScratchRewardClaim,
  BattleAudienceSession,
  BattleFighter,
  BattleGiftRecord,
  VoiceRoomMemberSession,
  VoiceRoomMessage,
  VoiceRoomGiftRecord,
} from "../models/index.js";

export class AdminUserNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.code = "USER_NOT_FOUND";
  }
}

const destroyUserScopedRows = async (userId, transaction) => {
  const callRows = await CallHistory.findAll({
    where: {
      [Op.or]: [{ callerId: userId }, { receiverId: userId }],
    },
    attributes: ["id"],
    transaction,
  });

  const callIds = callRows.map((row) => row.id);

  if (callIds.length) {
    await Earning.destroy({
      where: { callId: { [Op.in]: callIds } },
      transaction,
    });

    await CallRating.destroy({
      where: {
        [Op.or]: [
          { callHistoryId: { [Op.in]: callIds } },
          { callerId: userId },
          { femaleId: userId },
        ],
      },
      transaction,
    });
  }

  await Promise.all([
    WalletTransaction.destroy({ where: { userId }, transaction }),
    PaymentOrder.destroy({ where: { userId }, transaction }),
    Wallet.destroy({ where: { userId }, transaction }),
    Favorite.destroy({
      where: {
        [Op.or]: [{ userId }, { favoriteUserId: userId }],
      },
      transaction,
    }),
    Earning.destroy({ where: { userId }, transaction }),
    Withdraw.destroy({ where: { userId }, transaction }),
    Kyc.destroy({ where: { userId }, transaction }),
    DeviceToken.destroy({ where: { userId }, transaction }),
    NotificationRecord.destroy({ where: { userId }, transaction }),
    ChatMessage.destroy({
      where: {
        [Op.or]: [{ senderId: userId }, { receiverId: userId }],
      },
      transaction,
    }),
    CallGiftRecord.destroy({
      where: {
        [Op.or]: [{ senderId: userId }, { receiverId: userId }],
      },
      transaction,
    }),
    Block.destroy({
      where: {
        [Op.or]: [{ blockerId: userId }, { blockedUserId: userId }],
      },
      transaction,
    }),
    AccountDeletionRequest.destroy({ where: { userId }, transaction }),
    UserOnlineLog.destroy({ where: { userId }, transaction }),
    MaleScratchRewardClaim.destroy({ where: { userId }, transaction }),
    FemaleScratchRewardClaim.destroy({ where: { userId }, transaction }),
    BattleAudienceSession.destroy({ where: { userId }, transaction }),
    BattleFighter.destroy({ where: { userId }, transaction }),
    BattleGiftRecord.destroy({
      where: {
        [Op.or]: [{ senderId: userId }, { receiverId: userId }],
      },
      transaction,
    }),
    VoiceRoomMemberSession.destroy({ where: { userId }, transaction }),
    VoiceRoomMessage.destroy({ where: { userId }, transaction }),
    VoiceRoomGiftRecord.destroy({
      where: {
        [Op.or]: [{ senderId: userId }, { receiverId: userId }],
      },
      transaction,
    }),
  ]);

  const tickets = await SupportTicket.findAll({
    where: { userId },
    attributes: ["id"],
    transaction,
  });

  const ticketIds = tickets.map((ticket) => ticket.id);

  if (ticketIds.length) {
    await SupportMessage.destroy({
      where: { ticketId: { [Op.in]: ticketIds } },
      transaction,
    });

    await SupportTicket.destroy({ where: { userId }, transaction });
  }

  await CallHistory.destroy({
    where: {
      [Op.or]: [{ callerId: userId }, { receiverId: userId }],
    },
    transaction,
  });

  const auxiliaryDeletes = [
    "DELETE FROM female_task_claims WHERE userId = ?",
    "DELETE FROM male_task_claims WHERE userId = ?",
  ];

  for (const sql of auxiliaryDeletes) {
    try {
      await sequelize.query(sql, {
        replacements: [userId],
        transaction,
      });
    } catch {
      // table may not exist on older DBs
    }
  }
};

const softDeleteUser = async (user, transaction) => {
  const userId = user.id;

  await user.update(
    {
      online: false,
      accountStatus: "deleted",
      phone: `deleted_${userId}_${Date.now()}`,
      loginPinHash: null,
      nickname: "Deleted User",
      name: "Deleted User",
      username: `deleted_${userId}_${Date.now()}`,
      avatar: null,
      verified: false,
      profileCompleted: true,
    },
    { transaction }
  );

  try {
    await sequelize.query("UPDATE users SET blocked = 1 WHERE id = ?", {
      replacements: [userId],
      transaction,
    });
  } catch {
    // blocked column may be missing on older DBs
  }
};

export const deleteAdminUserById = async (userId) => {
  const transaction = await sequelize.transaction();

  try {
    const user = await User.findByPk(userId, { transaction });

    if (!user) {
      throw new AdminUserNotFoundError();
    }

    await destroyUserScopedRows(userId, transaction);

    try {
      await user.destroy({ transaction });
    } catch {
      await softDeleteUser(user, transaction);
    }

    await transaction.commit();

    return { success: true };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // transaction may already be finished
    }
    throw error;
  }
};
