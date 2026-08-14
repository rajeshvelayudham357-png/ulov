import { Op } from "sequelize";

import { User } from "../models/index.js";
import { closeActiveCallsForUser } from "./callState.service.js";
import { recordFemaleOnlineSessionEnd } from "./femaleOnlineTime.service.js";

let ioInstance = null;
let onlineUsersRef = null;

export const setFemaleOfflineSocketInstance = (io, onlineUsers) => {
  ioInstance = io;
  onlineUsersRef = onlineUsers;
};

const emitFemaleOffline = (userId) => {
  const payload = {
    userId: String(userId),
    status: "offline",
    online: false,
  };

  ioInstance?.emit("user-status-changed", payload);

  const socketId = onlineUsersRef?.get(Number(userId));
  if (socketId) {
    ioInstance?.to(socketId).emit("admin-force-offline", payload);
    onlineUsersRef.delete(Number(userId));
  }
};

export const forceFemaleOffline = async (userId, { closeCalls = true } = {}) => {
  const normalizedUserId = Number(userId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error("Valid user id is required");
  }

  const user = await User.findByPk(normalizedUserId);

  if (!user) {
    throw new Error("User not found");
  }

  const isFemale =
    String(user.gender || "").toLowerCase() === "female";

  if (!isFemale) {
    throw new Error("Only female creators can be managed on this page");
  }

  const wasOnline = Boolean(user.online);

  if (wasOnline) {
    await recordFemaleOnlineSessionEnd(normalizedUserId);
  }

  await user.update({
    online: false,
    lastSeen: new Date(),
  });

  if (closeCalls) {
    await closeActiveCallsForUser(normalizedUserId, "completed");
  }

  emitFemaleOffline(normalizedUserId);

  return {
    userId: normalizedUserId,
    wasOnline,
    displayName:
      user.nickname ||
      (user.name && user.name !== "New User" ? user.name : null) ||
      user.username ||
      `User ${normalizedUserId}`,
  };
};

export const forceAllFemalesOffline = async () => {
  const onlineFemales = await User.findAll({
    where: {
      gender: {
        [Op.in]: ["Female", "female"],
      },
      online: true,
    },
    attributes: ["id"],
  });

  const results = [];

  for (const row of onlineFemales) {
    try {
      const result = await forceFemaleOffline(row.id);
      results.push(result);
    } catch (error) {
      results.push({
        userId: row.id,
        error: error.message,
      });
    }
  }

  return {
    requested: onlineFemales.length,
    processed: results.filter((item) => !item.error).length,
    results,
  };
};
