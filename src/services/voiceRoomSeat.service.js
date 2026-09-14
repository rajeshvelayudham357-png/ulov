import { Op } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  VOICE_ROOM_MEMBER_ROLES,
  VOICE_ROOM_MEMBER_STATUSES,
  VOICE_ROOM_SESSION_STATUSES,
  VOICE_ROOM_STATUSES,
} from "../constants/voiceRoom.js";
import {
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSeat,
  VoiceRoomSession,
} from "../models/index.js";
import { isUserInActiveOneToOneCall } from "./voiceRoomCallGuard.service.js";
import {
  assertVoiceRoomFeatureEnabled,
  getVoiceRoomDetail,
} from "./voiceRoom.service.js";
import {
  emitVoiceRoomSeatLeft,
  emitVoiceRoomSeatTaken,
} from "./voiceRoomRealtime.service.js";
import { ensureVoiceRoomSchema } from "./voiceRoomSchema.service.js";

const ACTIVE_MEMBER_STATUSES = [
  VOICE_ROOM_MEMBER_STATUSES.JOINING,
  VOICE_ROOM_MEMBER_STATUSES.CONNECTED,
  VOICE_ROOM_MEMBER_STATUSES.BILLING,
];

export class VoiceRoomSeatConflictError extends Error {
  constructor(message = "Seat is no longer available") {
    super(message);
    this.name = "VoiceRoomSeatConflictError";
    this.statusCode = 409;
  }
}

export class VoiceRoomMembershipConflictError extends Error {
  constructor(message = "You are already in this voice room") {
    super(message);
    this.name = "VoiceRoomMembershipConflictError";
    this.statusCode = 409;
  }
}

export class VoiceRoomUserInCallError extends Error {
  constructor(message = "Finish your current call before joining a voice room") {
    super(message);
    this.name = "VoiceRoomUserInCallError";
    this.statusCode = 409;
  }
}

export class VoiceRoomAuthorizationError extends Error {
  constructor(message = "Not allowed to modify this seat") {
    super(message);
    this.name = "VoiceRoomAuthorizationError";
    this.statusCode = 403;
  }
}

const buildActiveMembershipGuard = (userId) => `user:${Number(userId)}`;

const buildReleasedMembershipGuard = (memberSessionId) =>
  `left:${Number(memberSessionId)}`;

const getLiveSessionForRoom = async (roomId, transaction) =>
  VoiceRoomSession.findOne({
    where: {
      roomId: Number(roomId),
      status: VOICE_ROOM_SESSION_STATUSES.LIVE,
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

export const joinVoiceRoomSeat = async (userId, roomId, seatIndex) => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const normalizedUserId = Number(userId);
  const normalizedRoomId = Number(roomId);
  const normalizedSeatIndex = Number(seatIndex);

  if (!Number.isFinite(normalizedSeatIndex) || normalizedSeatIndex < 1) {
    throw new Error("Seat not found");
  }

  if (await isUserInActiveOneToOneCall(normalizedUserId)) {
    throw new VoiceRoomUserInCallError();
  }

  const transaction = await sequelize.transaction();

  try {
    const room = await VoiceRoom.findByPk(normalizedRoomId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!room) {
      throw new Error("Voice room not found");
    }

    if (room.status !== VOICE_ROOM_STATUSES.LIVE) {
      throw new Error("Voice room is not live");
    }

    if (normalizedSeatIndex > Number(room.maxSeats)) {
      throw new Error("Seat not found");
    }

    const liveSession = await getLiveSessionForRoom(room.id, transaction);

    if (!liveSession) {
      throw new Error("Active voice room session not found");
    }

    const existingMembership = await VoiceRoomMemberSession.findOne({
      where: {
        sessionId: liveSession.id,
        userId: normalizedUserId,
        status: {
          [Op.in]: ACTIVE_MEMBER_STATUSES,
        },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingMembership) {
      if (Number(existingMembership.seatIndex) === normalizedSeatIndex) {
        await transaction.commit();
        return getVoiceRoomDetail(room.id, normalizedUserId);
      }

      throw new VoiceRoomMembershipConflictError(
        "You are already seated in this voice room"
      );
    }

    const seat = await VoiceRoomSeat.findOne({
      where: {
        roomId: room.id,
        seatIndex: normalizedSeatIndex,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!seat) {
      throw new Error("Seat not found");
    }

    if (seat.memberSessionId) {
      throw new VoiceRoomSeatConflictError("Seat is already occupied");
    }

    const now = new Date();
    const isHost = Number(room.hostUserId) === normalizedUserId;

    if (isHost && normalizedSeatIndex === 1) {
      throw new VoiceRoomMembershipConflictError(
        "Host is already seated in this voice room"
      );
    }

    let memberSession;

    try {
      memberSession = await VoiceRoomMemberSession.create(
        {
          sessionId: liveSession.id,
          roomId: room.id,
          userId: normalizedUserId,
          seatIndex: normalizedSeatIndex,
          role: isHost
            ? VOICE_ROOM_MEMBER_ROLES.HOST
            : VOICE_ROOM_MEMBER_ROLES.PARTICIPANT,
          status: VOICE_ROOM_MEMBER_STATUSES.CONNECTED,
          isBillable: !isHost,
          joinedAt: now,
          lastHeartbeatAt: now,
          billingStartedAt: null,
          agoraUid: normalizedUserId,
          activeMembershipGuard: buildActiveMembershipGuard(normalizedUserId),
        },
        { transaction }
      );
    } catch (error) {
      if (
        String(error?.name || "").includes("SequelizeUniqueConstraintError") ||
        String(error?.message || "").includes("Duplicate")
      ) {
        throw new VoiceRoomMembershipConflictError(
          "You are already active in another voice room"
        );
      }

      throw error;
    }

    const [claimedCount] = await VoiceRoomSeat.update(
      { memberSessionId: memberSession.id },
      {
        where: {
          id: seat.id,
          memberSessionId: null,
        },
        transaction,
      }
    );

    if (!claimedCount) {
      throw new VoiceRoomSeatConflictError("Seat is already occupied");
    }

    await transaction.commit();

    emitVoiceRoomSeatTaken(room.id, {
      roomId: room.id,
      sessionId: liveSession.id,
      seatIndex: normalizedSeatIndex,
      userId: normalizedUserId,
      memberSessionId: memberSession.id,
      isHost,
    });

    return getVoiceRoomDetail(room.id, normalizedUserId);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const leaveVoiceRoomSeat = async (userId, roomId, seatIndex = null) => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const normalizedUserId = Number(userId);
  const normalizedRoomId = Number(roomId);
  const requestedSeatIndex =
    seatIndex == null || seatIndex === ""
      ? null
      : Number(seatIndex);

  const transaction = await sequelize.transaction();

  try {
    const room = await VoiceRoom.findByPk(normalizedRoomId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!room) {
      throw new Error("Voice room not found");
    }

    const liveSession = await getLiveSessionForRoom(room.id, transaction);

    if (!liveSession) {
      throw new Error("Active voice room session not found");
    }

    const memberSession = await VoiceRoomMemberSession.findOne({
      where: {
        sessionId: liveSession.id,
        userId: normalizedUserId,
        status: {
          [Op.in]: ACTIVE_MEMBER_STATUSES,
        },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!memberSession) {
      throw new VoiceRoomAuthorizationError(
        "You are not seated in this voice room"
      );
    }

    const resolvedSeatIndex = Number(memberSession.seatIndex);

    if (
      Number.isFinite(requestedSeatIndex) &&
      requestedSeatIndex >= 1 &&
      requestedSeatIndex !== resolvedSeatIndex
    ) {
      throw new VoiceRoomAuthorizationError("Membership not found for this seat");
    }

    const now = new Date();

    await memberSession.update(
      {
        status: VOICE_ROOM_MEMBER_STATUSES.LEFT,
        leftAt: now,
        activeMembershipGuard: buildReleasedMembershipGuard(memberSession.id),
      },
      { transaction }
    );

    await VoiceRoomSeat.update(
      { memberSessionId: null },
      {
        where: {
          roomId: room.id,
          seatIndex: resolvedSeatIndex,
          memberSessionId: memberSession.id,
        },
        transaction,
      }
    );

    await transaction.commit();

    emitVoiceRoomSeatLeft(room.id, {
      roomId: room.id,
      sessionId: liveSession.id,
      seatIndex: resolvedSeatIndex,
      userId: normalizedUserId,
      memberSessionId: memberSession.id,
    });

    return getVoiceRoomDetail(room.id, normalizedUserId);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
