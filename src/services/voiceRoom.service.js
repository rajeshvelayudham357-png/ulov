import { Op } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  VOICE_ROOM_MAX_SEATS_V1,
  VOICE_ROOM_MEMBER_ROLES,
  VOICE_ROOM_MEMBER_STATUSES,
  VOICE_ROOM_SESSION_STATUSES,
  VOICE_ROOM_STATUSES,
  getVoiceRoomChannelName,
  normalizeVoiceRoomCoverImageKey,
} from "../constants/voiceRoom.js";
import {
  User,
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSeat,
  VoiceRoomSession,
} from "../models/index.js";
import {
  ensureVoiceRoomSchema,
  getVoiceRoomSettings,
  isVoiceRoomFeatureEnabled,
} from "./voiceRoomSchema.service.js";
import { emitVoiceRoomClosed } from "./voiceRoomRealtime.service.js";

const ACTIVE_MEMBER_STATUSES = [
  VOICE_ROOM_MEMBER_STATUSES.JOINING,
  VOICE_ROOM_MEMBER_STATUSES.CONNECTED,
  VOICE_ROOM_MEMBER_STATUSES.BILLING,
];

export class VoiceRoomFeatureDisabledError extends Error {
  constructor(message = "Voice Room is not available") {
    super(message);
    this.name = "VoiceRoomFeatureDisabledError";
    this.statusCode = 403;
  }
}

export const assertVoiceRoomFeatureEnabled = async () => {
  const enabled = await isVoiceRoomFeatureEnabled();

  if (!enabled) {
    throw new VoiceRoomFeatureDisabledError();
  }
};

const clampMaxSeats = (value, settingsMaxSeats) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 2) {
    return 2;
  }

  const cap = Math.min(
    VOICE_ROOM_MAX_SEATS_V1,
    Number(settingsMaxSeats) || VOICE_ROOM_MAX_SEATS_V1
  );

  return Math.min(Math.floor(parsed), cap);
};

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

const serializeMemberSession = (member, userMap = new Map()) => {
  if (!member) {
    return null;
  }

  const data =
    typeof member.toJSON === "function" ? member.toJSON() : { ...member };

  return {
    id: data.id,
    userId: data.userId,
    seatIndex: data.seatIndex,
    role: data.role,
    status: data.status,
    isBillable: Boolean(data.isBillable),
    joinedAt: data.joinedAt,
    leftAt: data.leftAt ?? null,
    coinsSpent: Number(data.coinsSpent) || 0,
    user: serializeUserPreview(userMap.get(String(data.userId))),
  };
};

export const getVoiceRoomFeatureStatus = async () => {
  await ensureVoiceRoomSchema();
  const settings = await getVoiceRoomSettings();

  return {
    enabled: Boolean(settings.enabled),
    maxSeats: settings.maxSeats,
    ratePerMinute: settings.ratePerMinute,
  };
};

export const createVoiceRoom = async (
  hostUserId,
  { title, maxSeats, coverImageKey }
) => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const settings = await getVoiceRoomSettings();
  const normalizedTitle = String(title ?? "").trim();

  if (!normalizedTitle) {
    throw new Error("Room title is required");
  }

  const room = await VoiceRoom.create({
    hostUserId: Number(hostUserId),
    title: normalizedTitle.slice(0, 128),
    maxSeats: clampMaxSeats(maxSeats, settings.maxSeats),
    status: VOICE_ROOM_STATUSES.DRAFT,
    coverImageKey: normalizeVoiceRoomCoverImageKey(coverImageKey),
  });

  return getVoiceRoomDetail(room.id, hostUserId);
};

const buildActiveMembershipGuard = (userId) => `user:${Number(userId)}`;

const buildReleasedMembershipGuard = (memberSessionId) =>
  `left:${Number(memberSessionId)}`;

const isUniqueConstraintError = (error) =>
  String(error?.name || "").includes("SequelizeUniqueConstraintError") ||
  /duplicate/i.test(String(error?.message || ""));

const releaseMemberSessionLock = async (membership, now = new Date()) => {
  await membership.update({
    status: VOICE_ROOM_MEMBER_STATUSES.LEFT,
    leftAt: membership.leftAt ?? now,
    activeMembershipGuard: buildReleasedMembershipGuard(membership.id),
  });

  await VoiceRoomSeat.update(
    { memberSessionId: null },
    { where: { memberSessionId: membership.id } }
  );
};

const clearUserVoiceRoomLocks = async (userId) => {
  const now = new Date();
  const normalizedUserId = Number(userId);
  const lockedMemberships = await VoiceRoomMemberSession.findAll({
    where: {
      [Op.or]: [
        { activeMembershipGuard: buildActiveMembershipGuard(normalizedUserId) },
        {
          userId: normalizedUserId,
          status: {
            [Op.in]: ACTIVE_MEMBER_STATUSES,
          },
        },
      ],
    },
  });

  for (const membership of lockedMemberships) {
    const room = await VoiceRoom.findByPk(membership.roomId);
    const session = await VoiceRoomSession.findByPk(membership.sessionId);
    const stillLive =
      room?.status === VOICE_ROOM_STATUSES.LIVE &&
      session?.status === VOICE_ROOM_SESSION_STATUSES.LIVE;

    if (stillLive && Number(room.hostUserId) === normalizedUserId) {
      await closeLiveVoiceRoomSession(room, session, now);
      continue;
    }

    await releaseMemberSessionLock(membership, now);
  }

  const hostedLiveRooms = await VoiceRoom.findAll({
    where: {
      hostUserId: normalizedUserId,
      status: VOICE_ROOM_STATUSES.LIVE,
    },
  });

  for (const room of hostedLiveRooms) {
    const liveSession = await VoiceRoomSession.findOne({
      where: {
        roomId: room.id,
        status: VOICE_ROOM_SESSION_STATUSES.LIVE,
      },
      order: [["startedAt", "DESC"]],
    });

    await closeLiveVoiceRoomSession(room, liveSession, now);
  }
};

const closeLiveVoiceRoomSession = async (room, liveSession, now = new Date()) => {
  if (liveSession) {
    await sequelize.query(
      `UPDATE voice_room_member_sessions
       SET status = :leftStatus,
           leftAt = :leftAt,
           activeMembershipGuard = CONCAT('left:', id)
       WHERE sessionId = :sessionId
         AND status IN (:activeStatuses)`,
      {
        replacements: {
          leftStatus: VOICE_ROOM_MEMBER_STATUSES.LEFT,
          leftAt: now,
          sessionId: liveSession.id,
          activeStatuses: ACTIVE_MEMBER_STATUSES,
        },
      }
    );

    await VoiceRoomSeat.update(
      { memberSessionId: null },
      { where: { roomId: room.id } }
    );

    await liveSession.update({
      status: VOICE_ROOM_SESSION_STATUSES.CLOSED,
      endedAt: now,
    });

    emitVoiceRoomClosed(room.id, {
      roomId: room.id,
      sessionId: liveSession.id,
    });
  }

  await room.update({ status: VOICE_ROOM_STATUSES.CLOSED });

  return {
    roomId: room.id,
    status: VOICE_ROOM_STATUSES.CLOSED,
    closedAt: now,
  };
};

export const listLiveVoiceRooms = async () => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const rooms = await VoiceRoom.findAll({
    where: {
      status: VOICE_ROOM_STATUSES.LIVE,
    },
    order: [["updatedAt", "DESC"]],
    include: [
      {
        model: User,
        as: "host",
        attributes: ["id", "name", "username", "avatar", "gender"],
      },
      {
        model: VoiceRoomSession,
        as: "sessions",
        required: true,
        where: {
          status: VOICE_ROOM_SESSION_STATUSES.LIVE,
        },
        limit: 1,
        order: [["startedAt", "DESC"]],
      },
    ],
  });

  const roomIds = rooms.map((room) => room.id);
  const occupiedCounts = roomIds.length
    ? await VoiceRoomMemberSession.findAll({
        attributes: [
          "roomId",
          [
            VoiceRoomMemberSession.sequelize.fn(
              "COUNT",
              VoiceRoomMemberSession.sequelize.col("id")
            ),
            "participantCount",
          ],
        ],
        where: {
          roomId: { [Op.in]: roomIds },
          status: { [Op.in]: ACTIVE_MEMBER_STATUSES },
        },
        group: ["roomId"],
        raw: true,
      })
    : [];

  const countMap = new Map(
    occupiedCounts.map((row) => [
      String(row.roomId),
      Number(row.participantCount) || 0,
    ])
  );

  return rooms.map((room) => {
    const roomData = room.toJSON();

    return {
      id: roomData.id,
      title: roomData.title,
      maxSeats: roomData.maxSeats,
      status: roomData.status,
      coverImageKey: normalizeVoiceRoomCoverImageKey(roomData.coverImageKey),
      host: serializeUserPreview(roomData.host),
      participantCount: countMap.get(String(roomData.id)) ?? 0,
      sessionId: roomData.sessions?.[0]?.id ?? null,
    };
  });
};

export const listAdminLiveVoiceRooms = async () => {
  await ensureVoiceRoomSchema();

  const rooms = await VoiceRoom.findAll({
    where: {
      status: VOICE_ROOM_STATUSES.LIVE,
    },
    order: [["updatedAt", "DESC"]],
    include: [
      {
        model: User,
        as: "host",
        attributes: ["id", "name", "username", "avatar", "gender"],
      },
      {
        model: VoiceRoomSession,
        as: "sessions",
        required: true,
        where: {
          status: VOICE_ROOM_SESSION_STATUSES.LIVE,
        },
        limit: 1,
        order: [["startedAt", "DESC"]],
      },
    ],
  });

  const roomIds = rooms.map((room) => room.id);
  const occupiedCounts = roomIds.length
    ? await VoiceRoomMemberSession.findAll({
        attributes: [
          "roomId",
          [
            VoiceRoomMemberSession.sequelize.fn(
              "COUNT",
              VoiceRoomMemberSession.sequelize.col("id")
            ),
            "participantCount",
          ],
        ],
        where: {
          roomId: { [Op.in]: roomIds },
          status: { [Op.in]: ACTIVE_MEMBER_STATUSES },
        },
        group: ["roomId"],
        raw: true,
      })
    : [];

  const countMap = new Map(
    occupiedCounts.map((row) => [
      String(row.roomId),
      Number(row.participantCount) || 0,
    ])
  );

  return rooms.map((room) => {
    const roomData = room.toJSON();
    const liveSession = roomData.sessions?.[0] ?? null;

    return {
      id: roomData.id,
      title: roomData.title,
      maxSeats: roomData.maxSeats,
      status: roomData.status,
      coverImageKey: normalizeVoiceRoomCoverImageKey(roomData.coverImageKey),
      hostUserId: roomData.hostUserId,
      host: serializeUserPreview(roomData.host),
      participantCount: countMap.get(String(roomData.id)) ?? 0,
      sessionId: liveSession?.id ?? null,
      startedAt: liveSession?.startedAt ?? null,
      createdAt: roomData.createdAt,
      updatedAt: roomData.updatedAt,
    };
  });
};

export const getVoiceRoomDetail = async (roomId, viewerUserId = null) => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const room = await VoiceRoom.findByPk(roomId, {
    include: [
      {
        model: User,
        as: "host",
        attributes: ["id", "name", "username", "avatar", "gender"],
      },
      {
        model: VoiceRoomSession,
        as: "sessions",
        required: false,
        separate: true,
        order: [["startedAt", "DESC"]],
        limit: 1,
      },
      {
        model: VoiceRoomSeat,
        as: "seats",
        required: false,
        separate: true,
        order: [["seatIndex", "ASC"]],
      },
    ],
  });

  if (!room) {
    throw new Error("Voice room not found");
  }

  const roomData = room.toJSON();
  const liveSession = (roomData.sessions ?? []).find(
    (session) => session.status === VOICE_ROOM_SESSION_STATUSES.LIVE
  );

  let memberSessions = [];

  if (liveSession?.id) {
    memberSessions = await VoiceRoomMemberSession.findAll({
      where: {
        sessionId: liveSession.id,
        status: { [Op.in]: ACTIVE_MEMBER_STATUSES },
      },
      order: [["seatIndex", "ASC"]],
    });
  }

  const userIds = memberSessions.map((member) => member.userId);

  if (roomData.hostUserId) {
    userIds.push(roomData.hostUserId);
  }

  const users = userIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: [...new Set(userIds)] } },
        attributes: ["id", "name", "username", "avatar", "gender"],
      })
    : [];

  const userMap = new Map(users.map((user) => [String(user.id), user]));
  const memberBySeat = new Map(
    memberSessions.map((member) => [Number(member.seatIndex), member])
  );

  const seats = (roomData.seats ?? []).map((seat) => {
    const member = memberBySeat.get(Number(seat.seatIndex));

    return {
      seatIndex: seat.seatIndex,
      occupied: Boolean(member),
      memberSession: serializeMemberSession(member, userMap),
    };
  });

  return {
    id: roomData.id,
    title: roomData.title,
    maxSeats: roomData.maxSeats,
    status: roomData.status,
    coverImageKey: normalizeVoiceRoomCoverImageKey(roomData.coverImageKey),
    hostUserId: roomData.hostUserId,
    host: serializeUserPreview(roomData.host),
    session: liveSession
      ? {
          id: liveSession.id,
          agoraChannelName: liveSession.agoraChannelName,
          status: liveSession.status,
          startedAt: liveSession.startedAt,
          ratePerMinute: liveSession.ratePerMinute,
          hostPercentage: liveSession.hostPercentage,
        }
      : null,
    seats,
    viewerUserId: viewerUserId ? Number(viewerUserId) : null,
    isHost:
      viewerUserId != null &&
      Number(viewerUserId) === Number(roomData.hostUserId),
  };
};

export const startVoiceRoom = async (hostUserId, roomId) => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const room = await VoiceRoom.findByPk(roomId);

  if (!room) {
    throw new Error("Voice room not found");
  }

  if (Number(room.hostUserId) !== Number(hostUserId)) {
    throw new Error("Only the host can start this room");
  }

  if (room.status === VOICE_ROOM_STATUSES.LIVE) {
    return getVoiceRoomDetail(room.id, hostUserId);
  }

  if (room.status !== VOICE_ROOM_STATUSES.DRAFT) {
    throw new Error("This room can no longer be started");
  }

  await clearUserVoiceRoomLocks(hostUserId);

  const settings = await getVoiceRoomSettings();
  const now = new Date();
  const transaction = await sequelize.transaction();

  try {
    let session = await VoiceRoomSession.findOne({
      where: {
        roomId: room.id,
        status: VOICE_ROOM_SESSION_STATUSES.LIVE,
      },
      order: [["startedAt", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!session) {
      session = await VoiceRoomSession.create(
        {
          roomId: room.id,
          agoraChannelName: "pending",
          status: VOICE_ROOM_SESSION_STATUSES.LIVE,
          startedAt: now,
          ratePerMinute: settings.ratePerMinute,
          hostPercentage: settings.hostEarningPercentage,
        },
        { transaction }
      );

      await session.update(
        { agoraChannelName: getVoiceRoomChannelName(session.id) },
        { transaction }
      );
    }

    const seatRows = [];

    for (let seatIndex = 1; seatIndex <= room.maxSeats; seatIndex += 1) {
      seatRows.push({
        roomId: room.id,
        seatIndex,
        memberSessionId: null,
      });
    }

    await VoiceRoomSeat.bulkCreate(seatRows, {
      ignoreDuplicates: true,
      transaction,
    });

    let hostMemberSession = await VoiceRoomMemberSession.findOne({
      where: {
        sessionId: session.id,
        userId: Number(hostUserId),
        status: {
          [Op.in]: ACTIVE_MEMBER_STATUSES,
        },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!hostMemberSession) {
      hostMemberSession = await VoiceRoomMemberSession.create(
        {
          sessionId: session.id,
          roomId: room.id,
          userId: Number(hostUserId),
          seatIndex: 1,
          role: VOICE_ROOM_MEMBER_ROLES.HOST,
          status: VOICE_ROOM_MEMBER_STATUSES.CONNECTED,
          isBillable: false,
          joinedAt: now,
          lastHeartbeatAt: now,
          billingStartedAt: null,
          agoraUid: Number(hostUserId),
          activeMembershipGuard: buildActiveMembershipGuard(hostUserId),
        },
        { transaction }
      );
    }

    await VoiceRoomSeat.update(
      { memberSessionId: hostMemberSession.id },
      {
        where: {
          roomId: room.id,
          seatIndex: 1,
        },
        transaction,
      }
    );

    await room.update(
      { status: VOICE_ROOM_STATUSES.LIVE },
      { transaction }
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();

    if (isUniqueConstraintError(error)) {
      throw new Error(
        "You are already in another voice room. Leave that room and try again."
      );
    }

    throw error;
  }

  return getVoiceRoomDetail(room.id, hostUserId);
};

export const closeVoiceRoom = async (hostUserId, roomId) => {
  await assertVoiceRoomFeatureEnabled();
  await ensureVoiceRoomSchema();

  const room = await VoiceRoom.findByPk(roomId, {
    include: [
      {
        model: VoiceRoomSession,
        as: "sessions",
        required: false,
        where: {
          status: VOICE_ROOM_SESSION_STATUSES.LIVE,
        },
      },
    ],
  });

  if (!room) {
    throw new Error("Voice room not found");
  }

  if (Number(room.hostUserId) !== Number(hostUserId)) {
    throw new Error("Only the host can close this room");
  }

  const now = new Date();
  const liveSession = (room.sessions ?? [])[0] ?? null;

  return closeLiveVoiceRoomSession(room, liveSession, now);
};

export const adminForceCloseVoiceRoom = async (roomId) => {
  await ensureVoiceRoomSchema();

  const room = await VoiceRoom.findByPk(roomId, {
    include: [
      {
        model: VoiceRoomSession,
        as: "sessions",
        required: false,
        where: {
          status: VOICE_ROOM_SESSION_STATUSES.LIVE,
        },
      },
    ],
  });

  if (!room) {
    throw new Error("Voice room not found");
  }

  if (room.status === VOICE_ROOM_STATUSES.CLOSED) {
    return {
      roomId: room.id,
      status: VOICE_ROOM_STATUSES.CLOSED,
      closedAt: room.updatedAt,
      alreadyClosed: true,
    };
  }

  const liveSession = (room.sessions ?? [])[0] ?? null;

  return closeLiveVoiceRoomSession(room, liveSession);
};
