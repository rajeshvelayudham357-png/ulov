import { Op } from "sequelize";

import {
  ACTIVE_BATTLE_AUDIENCE_STATUSES,
  ACTIVE_BATTLE_FIGHTER_STATUSES,
  BATTLE_ROOM_STATUSES,
} from "../constants/battle.js";
import {
  BattleAudienceSession,
  BattleFighter,
  BattleRoom,
} from "../models/index.js";
import { BattleFeatureDisabledError } from "./battle.errors.js";
import { serializeBattleDetail } from "./battleDetail.service.js";
import {
  isBattleFeatureEnabled,
  ensureBattleSchema,
} from "./battleSchema.service.js";

let ioRef = null;
let onlineUsersRef = null;

export const getBattleSocketRoomName = (battleId) =>
  `battle:${Number(battleId)}`;

export const initBattleRealtime = (io, onlineUsers) => {
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

const emitToUser = (userId, event, payload) => {
  if (!ensureRealtimeReady()) {
    return false;
  }

  const keys = [
    ...new Set(
      [userId, String(userId), Number(userId)]
        .filter(
          (value) => value !== undefined && value !== null && value !== ""
        )
        .map((value) => String(value))
    ),
  ];

  let emitted = false;

  for (const key of keys) {
    const socketId = onlineUsersRef?.get(key);

    if (!socketId) {
      continue;
    }

    ioRef.to(socketId).emit(event, payload);
    emitted = true;
  }

  return emitted;
};

export const emitBattleStateToSocket = async (
  socketTarget,
  battleId,
  viewerUserId = null
) => {
  if (!ensureRealtimeReady() || !socketTarget) {
    return null;
  }

  const battle = await serializeBattleDetail(battleId, viewerUserId);
  socketTarget.emit("battle:state", { battle });
  return battle;
};

export const emitBattleStateToRoom = async (battleId) => {
  if (!ensureRealtimeReady()) {
    return null;
  }

  const battle = await serializeBattleDetail(battleId);
  ioRef
    .to(getBattleSocketRoomName(battleId))
    .emit("battle:state", { battle });

  return battle;
};

export const emitBattleInvite = (opponentId, payload) => {
  const normalizedPayload = {
    ...payload,
    id: payload?.id ?? payload?.inviteId,
    inviteId: payload?.inviteId ?? payload?.id,
  };

  const battleInviteEmitted = emitToUser(
    opponentId,
    "battle:invite",
    normalizedPayload
  );
  const notificationEmitted = emitToUser(opponentId, "notification", {
    type: "incoming_battle_invite",
    ...normalizedPayload,
  });

  return battleInviteEmitted || notificationEmitted;
};

export const emitBattleInviteAccepted = (userId, payload) => {
  emitToUser(userId, "battle:invite-accepted", payload);
};

export const emitBattleInviteDeclined = (userId, payload) => {
  emitToUser(userId, "battle:invite-declined", payload);
};

export const emitBattleStarted = (battleId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getBattleSocketRoomName(battleId))
    .emit("battle:started", payload);
};

export const emitBattleEnded = (battleId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getBattleSocketRoomName(battleId))
    .emit("battle:ended", payload);
};

export const emitBattleScore = (battleId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getBattleSocketRoomName(battleId))
    .emit("battle:score", payload);
};

export const emitBattleGiftSent = (battleId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getBattleSocketRoomName(battleId))
    .emit("battle:gift-sent", payload);
};

export const emitBattleAudienceJoined = (battleId, payload) => {
  if (!ensureRealtimeReady()) {
    return;
  }

  ioRef
    .to(getBattleSocketRoomName(battleId))
    .emit("battle:audience-joined", payload);
};

const assertBattleFeatureEnabled = async () => {
  const enabled = await isBattleFeatureEnabled();

  if (!enabled) {
    throw new BattleFeatureDisabledError();
  }
};

export const verifyBattleSocketAccess = async (userId, battleId) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();

  const normalizedBattleId = Number(battleId);
  const normalizedUserId = Number(userId);

  if (!Number.isFinite(normalizedBattleId) || normalizedBattleId <= 0) {
    throw new Error("Battle not found");
  }

  const battle = await BattleRoom.findByPk(normalizedBattleId);

  if (!battle) {
    throw new Error("Battle not found");
  }

  if (
    battle.status !== BATTLE_ROOM_STATUSES.ACCEPTED &&
    battle.status !== BATTLE_ROOM_STATUSES.LIVE &&
    battle.status !== BATTLE_ROOM_STATUSES.SETTLED
  ) {
    throw new Error("Battle is not available");
  }

  const fighter = await BattleFighter.findOne({
    where: {
      battleId: normalizedBattleId,
      userId: normalizedUserId,
      status: {
        [Op.in]: ACTIVE_BATTLE_FIGHTER_STATUSES,
      },
    },
  });

  const audience = fighter
    ? null
    : await BattleAudienceSession.findOne({
        where: {
          battleId: normalizedBattleId,
          userId: normalizedUserId,
          status: {
            [Op.in]: ACTIVE_BATTLE_AUDIENCE_STATUSES,
          },
        },
      });

  if (!fighter && !audience) {
    throw new Error("Battle membership required");
  }

  return { battle, fighter, audience };
};

export const isBattleSocketFeatureEnabled = async () =>
  isBattleFeatureEnabled();
