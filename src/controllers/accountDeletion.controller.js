import {
  AccountDeletionRequest,
  DeviceToken,
  User,
} from "../models/index.js";
import { sequelize } from "../config/database.js";

const getDisplayName = (user) => {
  if (!user) {
    return "Unknown";
  }

  return (
    user.nickname ||
    (user.name !== "New User" ? user.name : null) ||
    user.username ||
    "Unknown"
  );
};

const formatDeletionRequest = (row) => {
  const data = typeof row.toJSON === "function" ? row.toJSON() : row;
  const user = data.user || {};

  return {
    id: data.id,
    userId: data.userId,
    reason: data.reason || "",
    status: data.status,
    rejectReason: data.rejectReason || null,
    displayName: data.displayName || getDisplayName(user),
    phone: data.phone || user.phone || "—",
    gender: data.gender || user.gender || "—",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    processedAt: data.processedAt || null,
    creator: {
      id: user.id || data.userId,
      displayName: data.displayName || getDisplayName(user),
      phone: data.phone || user.phone || "—",
      gender: data.gender || user.gender || "—",
      avatar: user.avatar || null,
      accountStatus: user.accountStatus || null,
    },
  };
};

export const requestAccountDeletion = async (req, res) => {
  try {
    const { userId, reason } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (String(user.gender || "").toLowerCase() !== "female") {
      return res.status(403).json({
        message: "Only creator accounts can request deletion",
      });
    }

    const existingPending = await AccountDeletionRequest.findOne({
      where: {
        userId,
        status: "pending",
      },
    });

    if (existingPending) {
      return res.status(400).json({
        message: "A delete account request is already pending",
        request: formatDeletionRequest(existingPending),
      });
    }

    const created = await AccountDeletionRequest.create({
      userId,
      reason: String(reason || "").trim() || null,
      status: "pending",
      displayName: getDisplayName(user),
      phone: user.phone || null,
      gender: user.gender || "Female",
    });

    return res.json({
      message: "Delete account request submitted",
      request: formatDeletionRequest(created),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getAccountDeletionRequest = async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isFinite(userId)) {
      return res.status(400).json({
        message: "Valid userId is required",
      });
    }

    const request = await AccountDeletionRequest.findOne({
      where: { userId },
      order: [["createdAt", "DESC"]],
    });

    if (!request) {
      return res.json({
        request: null,
      });
    }

    return res.json({
      request: formatDeletionRequest(request),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const listAccountDeletionRequests = async (_req, res) => {
  try {
    const rows = await AccountDeletionRequest.findAll({
      include: [
        {
          model: User,
          as: "user",
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.json(rows.map(formatDeletionRequest));
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const deleteUserAccount = async (user, transaction) => {
  const userId = user.id;

  await DeviceToken.destroy({
    where: { userId },
    transaction,
  }).catch(() => undefined);

  try {
    await user.destroy({ transaction });
    return { mode: "hard" };
  } catch {
    await user.update(
      {
        online: false,
        accountStatus: "deleted",
        phone: `deleted_${userId}_${Date.now()}`,
        loginPinHash: null,
        nickname: "Deleted User",
        name: "Deleted User",
        username: `deleted_${userId}`,
        avatar: null,
        verified: false,
      },
      { transaction }
    );

    try {
      await sequelize.query(
        "UPDATE users SET blocked = 1 WHERE id = ?",
        {
          replacements: [userId],
          transaction,
        }
      );
    } catch {
      // blocked column may be missing on older DBs
    }

    return { mode: "soft" };
  }
};

export const approveAccountDeletionRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const request = await AccountDeletionRequest.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!request) {
      await transaction.rollback();
      return res.status(404).json({
        message: "Request not found",
      });
    }

    if (request.status !== "pending") {
      await transaction.rollback();
      return res.status(400).json({
        message: `Request is already ${request.status}`,
      });
    }

    const user = await User.findByPk(request.userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    let deletionMode = "missing";

    if (user) {
      const result = await deleteUserAccount(user, transaction);
      deletionMode = result.mode;
    }

    await request.update(
      {
        status: "approved",
        processedAt: new Date(),
        rejectReason: null,
      },
      { transaction }
    );

    await transaction.commit();

    return res.json({
      message:
        deletionMode === "hard"
          ? "Request approved and user deleted"
          : deletionMode === "soft"
            ? "Request approved and user account disabled"
            : "Request approved (user was already removed)",
      request: formatDeletionRequest(request),
      deletionMode,
    });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const rejectAccountDeletionRequest = async (req, res) => {
  try {
    const request = await AccountDeletionRequest.findByPk(req.params.id);

    if (!request) {
      return res.status(404).json({
        message: "Request not found",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        message: `Request is already ${request.status}`,
      });
    }

    await request.update({
      status: "rejected",
      rejectReason: String(req.body?.reason || "").trim() || null,
      processedAt: new Date(),
    });

    return res.json({
      message: "Delete account request rejected",
      request: formatDeletionRequest(request),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
