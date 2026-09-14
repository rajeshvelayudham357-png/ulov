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
import { assertVoiceRoomFeatureEnabled } from "./voiceRoom.service.js";
import { ensureVoiceRoomSchema } from "./voiceRoomSchema.service.js";

const ACTIVE_MEMBER_STATUSES = [
  VOICE_ROOM_MEMBER_STATUSES.JOINING,
  VOICE_ROOM_MEMBER_STATUSES.CONNECTED,
  VOICE_ROOM_MEMBER_STATUSES.BILLING,
];

export const getActiveVoiceRoomParticipation = async (userId, roomId) => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const normalizedUserId = Number(userId);
  const normalizedRoomId = Number(roomId);

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

  const membership = await VoiceRoomMemberSession.findOne({
    where: {
      sessionId: liveSession.id,
      roomId: normalizedRoomId,
      userId: normalizedUserId,
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

export const getActiveVoiceRoomMember = async (
  roomId,
  sessionId,
  targetUserId
) => {
  const normalizedUserId = Number(targetUserId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  return VoiceRoomMemberSession.findOne({
    where: {
      roomId: Number(roomId),
      sessionId: Number(sessionId),
      userId: normalizedUserId,
      status: {
        [Op.in]: ACTIVE_MEMBER_STATUSES,
      },
    },
  });
};

export { ACTIVE_MEMBER_STATUSES };
