import { Op } from "sequelize";

import {
  BATTLE_FIGHTER_SLOTS,
  BATTLE_ROOM_STATUSES,
} from "../constants/battle.js";
import {
  BattleAudienceSession,
  BattleFighter,
  BattleInvite,
  BattleRoom,
  User,
} from "../models/index.js";

const PLACEHOLDER_NAME = "New User";

const getBattleUserDisplayName = (user) => {
  const data = typeof user.toJSON === "function" ? user.toJSON() : user;
  const nickname = String(data?.nickname ?? "").trim();
  const name = String(data?.name ?? "").trim();
  const username = String(data?.username ?? "").trim();

  return (
    [nickname, name, username].find(
      (value) => value && value !== PLACEHOLDER_NAME
    ) || "User"
  );
};

const serializeUserPreview = (user) => {
  if (!user) {
    return null;
  }

  const data = typeof user.toJSON === "function" ? user.toJSON() : user;

  return {
    id: data.id,
    name: getBattleUserDisplayName(user),
    username: data.username ?? null,
    nickname: data.nickname ?? null,
    avatar: data.avatar ?? null,
    gender: data.gender ?? null,
  };
};

const serializeFighter = (fighter, userMap = new Map()) => {
  if (!fighter) {
    return null;
  }

  const data =
    typeof fighter.toJSON === "function" ? fighter.toJSON() : { ...fighter };

  return {
    id: data.id,
    userId: data.userId,
    slot: data.slot,
    scoreCoins: Number(data.scoreCoins) || 0,
    status: data.status,
    user: serializeUserPreview(userMap.get(String(data.userId))),
  };
};

export const serializeBattleDetail = async (battleId, viewerUserId = null) => {
  const battle = await BattleRoom.findByPk(battleId, {
    include: [
      {
        model: BattleFighter,
        as: "fighters",
      },
      {
        model: BattleInvite,
        as: "invite",
      },
    ],
  });

  if (!battle) {
    throw new Error("Battle not found");
  }

  const fighters = battle.fighters ?? [];
  const userIds = fighters.map((fighter) => fighter.userId);
  const users = userIds.length
    ? await User.findAll({
        where: { id: userIds },
        attributes: ["id", "name", "username", "nickname", "avatar", "gender"],
      })
    : [];

  const userMap = new Map(users.map((user) => [String(user.id), user]));

  const audienceCount = await BattleAudienceSession.count({
    where: {
      battleId: battle.id,
      status: {
        [Op.in]: ["joining", "connected"],
      },
    },
  });

  const audienceSessions = await BattleAudienceSession.findAll({
    where: {
      battleId: battle.id,
      status: {
        [Op.in]: ["joining", "connected"],
      },
    },
    order: [["joinedAt", "ASC"]],
    limit: 50,
  });

  const audienceUserIds = audienceSessions.map((session) => session.userId);
  const audienceUsers = audienceUserIds.length
    ? await User.findAll({
        where: { id: audienceUserIds },
        attributes: ["id", "name", "username", "nickname", "avatar", "gender"],
      })
    : [];
  const audienceUserMap = new Map(
    audienceUsers.map((user) => [String(user.id), user])
  );

  const audienceMembers = audienceSessions.map((session) => {
    const data =
      typeof session.toJSON === "function" ? session.toJSON() : { ...session };

    return {
      id: Number(data.userId),
      joinedAt: data.joinedAt,
      user: serializeUserPreview(audienceUserMap.get(String(data.userId))),
    };
  });

  const viewerAudienceJoined = viewerUserId
    ? audienceSessions.some(
        (session) => Number(session.userId) === Number(viewerUserId)
      )
    : false;

  const now = Date.now();
  const endsAtMs = battle.endsAt ? new Date(battle.endsAt).getTime() : null;
  const remainingSeconds =
    battle.status === BATTLE_ROOM_STATUSES.LIVE && endsAtMs
      ? Math.max(0, Math.ceil((endsAtMs - now) / 1000))
      : null;

  const fighterA = fighters.find((f) => f.slot === BATTLE_FIGHTER_SLOTS.A);
  const fighterB = fighters.find((f) => f.slot === BATTLE_FIGHTER_SLOTS.B);

  return {
    id: battle.id,
    status: battle.status,
    durationSeconds: battle.durationSeconds,
    startsAt: battle.startsAt,
    endsAt: battle.endsAt,
    settledAt: battle.settledAt,
    winnerFighterId: battle.winnerFighterId,
    remainingSeconds,
    audienceCount,
    audienceMembers,
    viewerAudienceJoined,
    inviteId: battle.inviteId,
    fighters: {
      A: serializeFighter(fighterA, userMap),
      B: serializeFighter(fighterB, userMap),
    },
    viewerUserId: viewerUserId ? Number(viewerUserId) : null,
  };
};
