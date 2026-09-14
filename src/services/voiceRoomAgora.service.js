import { Op } from "sequelize";

import {
  VOICE_ROOM_MEMBER_STATUSES,
  VOICE_ROOM_SESSION_STATUSES,
  VOICE_ROOM_STATUSES,
  getVoiceRoomChannelName,
} from "../constants/voiceRoom.js";
import {
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSession,
} from "../models/index.js";
import { generateAgoraToken, getAgoraAppId } from "./agora.service.js";
import {
  VoiceRoomFeatureDisabledError,
  assertVoiceRoomFeatureEnabled,
} from "./voiceRoom.service.js";
import { ensureVoiceRoomSchema } from "./voiceRoomSchema.service.js";

const ACTIVE_MEMBER_STATUSES = [
  VOICE_ROOM_MEMBER_STATUSES.JOINING,
  VOICE_ROOM_MEMBER_STATUSES.CONNECTED,
  VOICE_ROOM_MEMBER_STATUSES.BILLING,
];

export class VoiceRoomAgoraAuthorizationError extends Error {
  constructor(message = "Voice room membership required") {
    super(message);
    this.name = "VoiceRoomAgoraAuthorizationError";
    this.statusCode = 403;
  }
}

export class VoiceRoomAgoraNotFoundError extends Error {
  constructor(message = "Voice room not found") {
    super(message);
    this.name = "VoiceRoomAgoraNotFoundError";
    this.statusCode = 404;
  }
}

export class VoiceRoomAgoraUnavailableError extends Error {
  constructor(message = "Voice room is not available for audio") {
    super(message);
    this.name = "VoiceRoomAgoraUnavailableError";
    this.statusCode = 400;
  }
}

export const resolveVoiceRoomAgoraUid = (userId) => Number(userId);

export const getVoiceRoomAgoraChannelName = (sessionId) =>
  getVoiceRoomChannelName(sessionId);

const getActiveMembership = async (userId, roomId, sessionId) =>
  VoiceRoomMemberSession.findOne({
    where: {
      sessionId,
      roomId: Number(roomId),
      userId: Number(userId),
      status: {
        [Op.in]: ACTIVE_MEMBER_STATUSES,
      },
    },
  });

export const getVoiceRoomAgoraCredentials = async (userId, roomId) => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const normalizedUserId = Number(userId);
  const normalizedRoomId = Number(roomId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new VoiceRoomAgoraAuthorizationError("Authentication required");
  }

  if (!Number.isFinite(normalizedRoomId) || normalizedRoomId <= 0) {
    throw new VoiceRoomAgoraNotFoundError();
  }

  const room = await VoiceRoom.findByPk(normalizedRoomId);

  if (!room) {
    throw new VoiceRoomAgoraNotFoundError();
  }

  if (room.status !== VOICE_ROOM_STATUSES.LIVE) {
    throw new VoiceRoomAgoraUnavailableError("Voice room is not live");
  }

  const liveSession = await VoiceRoomSession.findOne({
    where: {
      roomId: normalizedRoomId,
      status: VOICE_ROOM_SESSION_STATUSES.LIVE,
    },
    order: [["startedAt", "DESC"]],
  });

  if (!liveSession) {
    throw new VoiceRoomAgoraUnavailableError("Active voice room session not found");
  }

  const membership = await getActiveMembership(
    normalizedUserId,
    normalizedRoomId,
    liveSession.id
  );

  if (!membership) {
    throw new VoiceRoomAgoraAuthorizationError();
  }

  const channelName = String(liveSession.agoraChannelName || "").trim();
  const expectedChannelName = getVoiceRoomChannelName(liveSession.id);

  if (!channelName || channelName !== expectedChannelName) {
    throw new VoiceRoomAgoraUnavailableError(
      "Voice room audio channel is not available"
    );
  }

  const uid = resolveVoiceRoomAgoraUid(membership.agoraUid ?? normalizedUserId);

  if (!Number.isFinite(uid) || uid <= 0) {
    throw new VoiceRoomAgoraUnavailableError("Invalid Agora UID for membership");
  }

  const [token, appId] = await Promise.all([
    generateAgoraToken(channelName, uid),
    getAgoraAppId(),
  ]);

  return {
    appId,
    channelName,
    token,
    uid,
    sessionId: liveSession.id,
    roomId: normalizedRoomId,
    memberSessionId: membership.id,
    seatIndex: membership.seatIndex,
    role: membership.role,
  };
};

export {
  VoiceRoomFeatureDisabledError,
};
