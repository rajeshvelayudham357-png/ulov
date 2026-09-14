import { Op } from "sequelize";

import {
  VOICE_ROOM_MEMBER_STATUSES,
  VOICE_ROOM_SESSION_STATUSES,
  VOICE_ROOM_STATUSES,
} from "../constants/voiceRoom.js";
import {
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSession,
} from "../models/index.js";
import { getVoiceRoomDetail, assertVoiceRoomFeatureEnabled } from "./voiceRoom.service.js";
import { isVoiceRoomFeatureEnabled } from "./voiceRoomSchema.service.js";

let ioRef = null;
let onlineUsersRef = null;

const ACTIVE_MEMBER_STATUSES = [
  VOICE_ROOM_MEMBER_STATUSES.JOINING,
  VOICE_ROOM_MEMBER_STATUSES.CONNECTED,
  VOICE_ROOM_MEMBER_STATUSES.BILLING,
];

export const getVoiceRoomSocketRoomName = (roomId) =>
  `voice-room:${Number(roomId)}`;

export const initVoiceRoomRealtime = (io, onlineUsers) => {
  ioRef = io;
  onlineUsersRef = onlineUsers;
};

export const resolveSocketUserId = (socketId, onlineUsers = onlineUsersRef) => {
  if (!socketId || !onlineUsers) {
    return null;
  }

  for (const [userId, mappedSocketId] of onlineUsers.entries()) {
    if (mappedSocketId === socketId) {
      return String(userId);
    }
  }

  return null;
};

const ensureRealtimeReady = () => Boolean(ioRef);

export const emitVoiceRoomStateToSocket = async (
  socketTarget,
  roomId,
  viewerUserId = null
) => {
  if (!ensureRealtimeReady() || !socketTarget) {
    return null;
  }

  const room = await getVoiceRoomDetail(roomId, viewerUserId);
  socketTarget.emit("voice-room:state", { room });
  return room;
};

export const emitVoiceRoomStateToRoom = async (roomId) => {
  if (!ensureRealtimeReady()) {
    return null;
  }

  const room = await getVoiceRoomDetail(roomId);
  ioRef
    .to(getVoiceRoomSocketRoomName(roomId))
    .emit("voice-room:state", { room });

  return room;
};

export const emitVoiceRoomSeatTaken = (roomId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getVoiceRoomSocketRoomName(roomId))
    .emit("voice-room:seat-taken", payload);
};

export const emitVoiceRoomSeatLeft = (roomId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getVoiceRoomSocketRoomName(roomId))
    .emit("voice-room:seat-left", payload);
};

export const emitVoiceRoomClosed = (roomId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getVoiceRoomSocketRoomName(roomId))
    .emit("voice-room:closed", payload);
};

export const emitVoiceRoomChatMessage = (roomId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getVoiceRoomSocketRoomName(roomId))
    .emit("voice-room:chat-message", payload);
};

export const emitVoiceRoomGiftSent = (roomId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getVoiceRoomSocketRoomName(roomId))
    .emit("voice-room:gift-sent", payload);
};

export const verifyVoiceRoomSocketViewAccess = async (userId, roomId) => {
  await assertVoiceRoomFeatureEnabled();

  const normalizedRoomId = Number(roomId);
  const normalizedUserId = Number(userId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error("Authentication required");
  }

  if (!Number.isFinite(normalizedRoomId) || normalizedRoomId <= 0) {
    throw new Error("Voice room not found");
  }

  const room = await VoiceRoom.findByPk(normalizedRoomId);

  if (!room) {
    throw new Error("Voice room not found");
  }

  if (room.status !== VOICE_ROOM_STATUSES.LIVE) {
    throw new Error("Voice room is not live");
  }

  const liveSession = await VoiceRoomSession.findOne({
    where: {
      roomId: normalizedRoomId,
      status: VOICE_ROOM_SESSION_STATUSES.LIVE,
    },
    order: [["startedAt", "DESC"]],
  });

  if (!liveSession) {
    throw new Error("Active voice room session not found");
  }

  return {
    room,
    liveSession,
  };
};

export const verifyVoiceRoomSocketAccess = async (userId, roomId) => {
  const { room, liveSession } = await verifyVoiceRoomSocketViewAccess(
    userId,
    roomId
  );

  const membership = await VoiceRoomMemberSession.findOne({
    where: {
      sessionId: liveSession.id,
      userId: Number(userId),
      status: {
        [Op.in]: ACTIVE_MEMBER_STATUSES,
      },
    },
  });

  if (!membership) {
    throw new Error("Voice room membership required");
  }

  return {
    room,
    liveSession,
    membership,
  };
};

export const isVoiceRoomSocketFeatureEnabled = async () =>
  isVoiceRoomFeatureEnabled();
