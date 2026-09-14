import { Op } from "sequelize";

import { User, VoiceRoomMemberSession, VoiceRoomMessage } from "../models/index.js";
import { emitVoiceRoomChatMessage, verifyVoiceRoomSocketViewAccess } from "./voiceRoomRealtime.service.js";
import { getActiveVoiceRoomParticipation } from "./voiceRoomMembership.service.js";
import { ensureVoiceRoomSchema } from "./voiceRoomSchema.service.js";

const MAX_MESSAGE_LENGTH = 240;
const DEFAULT_MESSAGE_LIMIT = 50;

const serializeUserPreview = (user) => {
  if (!user) {
    return null;
  }

  const data = typeof user.toJSON === "function" ? user.toJSON() : user;

  return {
    id: data.id,
    name: data.name ?? data.username ?? "User",
    avatar: data.avatar ?? null,
    gender: data.gender ?? null,
  };
};

export const listVoiceRoomChatMessages = async (
  userId,
  roomId,
  { limit = DEFAULT_MESSAGE_LIMIT, beforeId = null } = {}
) => {
  await ensureVoiceRoomSchema();
  const { liveSession } = await verifyVoiceRoomSocketViewAccess(userId, roomId);

  const normalizedLimit = Math.min(
    100,
    Math.max(1, Number(limit) || DEFAULT_MESSAGE_LIMIT)
  );

  const where = {
    roomId: Number(roomId),
    sessionId: liveSession.id,
  };

  if (beforeId) {
    where.id = {
      [Op.lt]: Number(beforeId),
    };
  }

  const messages = await VoiceRoomMessage.findAll({
    where,
    order: [["id", "DESC"]],
    limit: normalizedLimit,
  });

  const userIds = [...new Set(messages.map((message) => message.userId))];
  const users = userIds.length
    ? await User.findAll({
        where: { id: userIds },
        attributes: ["id", "name", "username", "avatar", "gender"],
      })
    : [];

  const userMap = new Map(users.map((user) => [String(user.id), user]));
  const memberships = userIds.length
    ? await VoiceRoomMemberSession.findAll({
        where: {
          sessionId: liveSession.id,
          userId: userIds,
        },
        attributes: ["userId", "seatIndex"],
      })
    : [];
  const seatMap = new Map(
    memberships.map((membership) => [
      String(membership.userId),
      membership.seatIndex,
    ])
  );

  return messages
    .reverse()
    .map((message) => {
      const data = message.toJSON();
      return {
        id: data.id,
        roomId: data.roomId,
        sessionId: data.sessionId,
        userId: data.userId,
        messageText: data.messageText,
        createdAt: data.createdAt,
        seatIndex: seatMap.get(String(data.userId)) ?? null,
        user: serializeUserPreview(userMap.get(String(data.userId))),
      };
    });
};

export const sendVoiceRoomChatMessage = async (userId, roomId, messageText) => {
  const { room, liveSession, membership } =
    await getActiveVoiceRoomParticipation(userId, roomId);

  const normalizedText = String(messageText ?? "").trim();

  if (!normalizedText) {
    throw new Error("Message cannot be empty");
  }

  if (normalizedText.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
  }

  const message = await VoiceRoomMessage.create({
    roomId: room.id,
    sessionId: liveSession.id,
    userId: Number(userId),
    messageText: normalizedText,
  });

  const user = await User.findByPk(userId, {
    attributes: ["id", "name", "username", "avatar", "gender"],
  });

  const payload = {
    id: message.id,
    roomId: room.id,
    sessionId: liveSession.id,
    userId: Number(userId),
    messageText: normalizedText,
    createdAt: message.createdAt,
    seatIndex: membership.seatIndex,
    user: serializeUserPreview(user),
  };

  emitVoiceRoomChatMessage(room.id, payload);

  return payload;
};
