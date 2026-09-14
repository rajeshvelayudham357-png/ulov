import { Op, QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  ACTIVE_BATTLE_FIGHTER_STATUSES,
  ACTIVE_BATTLE_INVITE_STATUSES,
  ACTIVE_BATTLE_ROOM_STATUSES,
  BATTLE_AUDIENCE_STATUSES,
  BATTLE_FIGHTER_SLOTS,
  BATTLE_FIGHTER_STATUSES,
  BATTLE_INVITE_STATUSES,
  BATTLE_ROOM_STATUSES,
  getBattleChannelName,
} from "../constants/battle.js";
import {
  BattleAudienceSession,
  BattleFighter,
  BattleInvite,
  BattleRoom,
  Favorite,
  User,
  VoiceRoom,
  VoiceRoomMemberSession,
  VoiceRoomSession,
} from "../models/index.js";
import { isUserInActiveOneToOneCall } from "./voiceRoomCallGuard.service.js";
import { getBlockedPeerIds } from "./block.service.js";
import {
  getLevelConfig,
  resolveUserLevel,
} from "./userLevel.service.js";
import { notifyIncomingBattleInvite } from "./notificationPush.service.js";
import { resolveVisibleEntryEffectId } from "./entryEffect.service.js";
import {
  ensureBattleSchema,
  getBattleSettings,
  isBattleFeatureEnabled,
} from "./battleSchema.service.js";
import {
  emitBattleEnded,
  emitBattleInvite,
  emitBattleInviteAccepted,
  emitBattleInviteDeclined,
  emitBattleScore,
  emitBattleStarted,
  emitBattleAudienceJoined,
  emitBattleStateToRoom,
} from "./battleRealtime.service.js";

import { serializeBattleDetail } from "./battleDetail.service.js";
import {
  BattleConflictError,
  BattleFeatureDisabledError,
  BattleUserInCallError,
} from "./battle.errors.js";

export {
  BattleConflictError,
  BattleFeatureDisabledError,
  BattleUserInCallError,
} from "./battle.errors.js";

export const assertBattleFeatureEnabled = async () => {
  const enabled = await isBattleFeatureEnabled();

  if (!enabled) {
    throw new BattleFeatureDisabledError();
  }
};

const buildActiveFighterGuard = (userId) => `fighter:${Number(userId)}`;

const buildReleasedFighterGuard = (fighterId) => `left:${Number(fighterId)}`;

const getBattleUserDisplayName = (user) => {
  const data = typeof user.toJSON === "function" ? user.toJSON() : user;
  const name = String(data.name ?? "").trim();
  const username = String(data.username ?? "").trim();
  const nickname = String(data.nickname ?? "").trim();

  if (nickname && nickname !== "New User") {
    return nickname;
  }

  if (name && name !== "New User") {
    return name;
  }

  if (username && username !== "New User") {
    return username;
  }

  return "User";
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

const serializeOpponentPreview = (user) => {
  if (!user) {
    return null;
  }

  const data = typeof user.toJSON === "function" ? user.toJSON() : user;

  return {
    ...serializeUserPreview(user),
    online: Boolean(data.online),
  };
};

const buildFemaleOpponentWhere = (excludedIds, search = "") => {
  const where = {
    id: {
      [Op.notIn]: excludedIds,
    },
    gender: {
      [Op.in]: ["female", "Female"],
    },
    accountStatus: "approved",
  };

  const normalizedSearch = String(search ?? "").trim();

  if (normalizedSearch) {
    where[Op.or] = [
      { username: { [Op.like]: `%${normalizedSearch}%` } },
      { name: { [Op.like]: `%${normalizedSearch}%` } },
      { nickname: { [Op.like]: `%${normalizedSearch}%` } },
    ];
  }

  return where;
};

const loadOpponentsByIds = async (
  orderedUserIds,
  { excludedIds, search = "", limit = 30 } = {}
) => {
  const uniqueIds = [
    ...new Set(
      orderedUserIds
        .map((value) => Number(value))
        .filter(
          (value) =>
            Number.isFinite(value) &&
            value > 0 &&
            !excludedIds.includes(value)
        )
    ),
  ].slice(0, limit);

  if (!uniqueIds.length) {
    return [];
  }

  const users = await User.findAll({
    where: {
      ...buildFemaleOpponentWhere(excludedIds, search),
      id: {
        [Op.in]: uniqueIds,
      },
    },
    attributes: ["id", "name", "username", "nickname", "avatar", "online", "gender"],
  });

  const userMap = new Map(users.map((user) => [Number(user.id), user]));

  return uniqueIds
    .map((userId) => userMap.get(userId))
    .filter(Boolean)
    .map((user) => serializeOpponentPreview(user));
};

const listRecentBattleOpponentIds = async (challengerId, limit = 30) => {
  const challengerFighters = await BattleFighter.findAll({
    where: { userId: challengerId },
    attributes: ["battleId"],
    order: [["updatedAt", "DESC"]],
    limit: Math.max(limit * 2, 30),
  });

  const battleIds = [
    ...new Set(
      challengerFighters
        .map((fighter) => Number(fighter.battleId))
        .filter((battleId) => Number.isFinite(battleId) && battleId > 0)
    ),
  ];

  if (!battleIds.length) {
    return [];
  }

  const opponentFighters = await BattleFighter.findAll({
    where: {
      battleId: {
        [Op.in]: battleIds,
      },
      userId: {
        [Op.ne]: challengerId,
      },
    },
    attributes: ["userId", "updatedAt"],
    order: [["updatedAt", "DESC"]],
  });

  const orderedIds = [];

  for (const fighter of opponentFighters) {
    const opponentId = Number(fighter.userId);

    if (
      !Number.isFinite(opponentId) ||
      opponentId <= 0 ||
      orderedIds.includes(opponentId)
    ) {
      continue;
    }

    orderedIds.push(opponentId);

    if (orderedIds.length >= limit) {
      break;
    }
  }

  return orderedIds;
};

const listFavoriteFemaleOpponentIds = async (challengerId, limit = 30) => {
  const favorites = await Favorite.findAll({
    where: { userId: challengerId },
    attributes: ["favoriteUserId"],
    order: [["id", "DESC"]],
    limit: Math.max(limit * 2, 30),
  });

  return favorites
    .map((favorite) => Number(favorite.favoriteUserId))
    .filter((userId) => Number.isFinite(userId) && userId > 0);
};

const getSameLevelCoinBounds = async (levelNumber) => {
  const configRows = await getLevelConfig("female");
  const activeRows = configRows
    .filter((row) => row.isActive)
    .sort((a, b) => a.levelNumber - b.levelNumber);
  const normalizedLevel = Number(levelNumber);

  const currentRow =
    activeRows.find((row) => Number(row.levelNumber) === normalizedLevel) ??
    activeRows[0];
  const currentIndex = activeRows.findIndex(
    (row) => row.levelNumber === currentRow.levelNumber
  );
  const nextRow =
    currentIndex >= 0 && currentIndex < activeRows.length - 1
      ? activeRows[currentIndex + 1]
      : null;

  return {
    levelNumber: currentRow.levelNumber,
    minCoins: currentRow.minimumCoins,
    maxCoinsExclusive: nextRow ? nextRow.minimumCoins : null,
  };
};

const listSameLevelFemaleOpponents = async (
  challengerId,
  { excludedIds, search = "", limit = 30 } = {}
) => {
  const challengerLevel = await resolveUserLevel(challengerId, "female");
  const { levelNumber, minCoins, maxCoinsExclusive } =
    await getSameLevelCoinBounds(Number(challengerLevel?.level ?? 0));

  const normalizedSearch = String(search ?? "").trim();
  const replacements = {
    minCoins,
    excludedIds,
    limit,
  };

  let searchClause = "";

  if (normalizedSearch) {
    searchClause =
      "AND (u.username LIKE :search OR u.name LIKE :search OR u.nickname LIKE :search)";
    replacements.search = `%${normalizedSearch}%`;
  }

  const havingClause =
    maxCoinsExclusive != null
      ? "HAVING eligibleCoins >= :minCoins AND eligibleCoins < :maxCoinsExclusive"
      : "HAVING eligibleCoins >= :minCoins";

  if (maxCoinsExclusive != null) {
    replacements.maxCoinsExclusive = maxCoinsExclusive;
  }

  const rows = await sequelize.query(
    `SELECT u.id, u.name, u.username, u.nickname, u.avatar, u.online, u.gender, u.updatedAt,
            COALESCE(SUM(e.coins), 0) AS eligibleCoins
     FROM users u
     LEFT JOIN earnings e ON e.userId = u.id AND e.callId IS NOT NULL
     WHERE u.gender IN ('female', 'Female')
       AND u.accountStatus = 'approved'
       AND u.id NOT IN (:excludedIds)
       ${searchClause}
     GROUP BY u.id, u.name, u.username, u.nickname, u.avatar, u.online, u.gender, u.updatedAt
     ${havingClause}
     ORDER BY u.online DESC, u.updatedAt DESC
     LIMIT :limit`,
    {
      replacements,
      type: QueryTypes.SELECT,
    }
  );

  return rows.map((user) => ({
    ...serializeOpponentPreview(user),
    online: Boolean(user.online),
    level: levelNumber,
  }));
};

const assertSameLevelOpponents = async (challengerId, opponentId) => {
  const [challengerLevel, opponentLevel] = await Promise.all([
    resolveUserLevel(challengerId, "female"),
    resolveUserLevel(opponentId, "female"),
  ]);

  if (
    Number(challengerLevel?.level ?? -1) !== Number(opponentLevel?.level ?? -2)
  ) {
    throw new Error("You can only challenge fighters at your level");
  }
};

const isUniqueConstraintError = (error) =>
  String(error?.name || "").includes("SequelizeUniqueConstraintError") ||
  /duplicate/i.test(String(error?.message || ""));

const releaseFighterLock = async (fighter, now = new Date()) => {
  await fighter.update({
    status: BATTLE_FIGHTER_STATUSES.LEFT,
    leftAt: fighter.leftAt ?? now,
    activeFighterGuard: buildReleasedFighterGuard(fighter.id),
  });
};

const clearStaleFighterLocks = async (userId) => {
  const normalizedUserId = Number(userId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return;
  }

  const lockedFighters = await BattleFighter.findAll({
    where: {
      userId: normalizedUserId,
      activeFighterGuard: buildActiveFighterGuard(normalizedUserId),
    },
    include: [
      {
        model: BattleRoom,
        as: "battle",
        required: false,
      },
    ],
  });

  const now = new Date();

  for (const fighter of lockedFighters) {
    const battleStatus = fighter.battle?.status;
    const stillActive = ACTIVE_BATTLE_ROOM_STATUSES.includes(battleStatus);

    if (stillActive) {
      continue;
    }

    await releaseFighterLock(fighter, now);
  }
};

const assertFemaleUser = (user, label = "User") => {
  if (!user) {
    throw new Error(`${label} not found`);
  }

  if (String(user.gender || "").toLowerCase() !== "female") {
    throw new Error("Only female users can participate as fighters");
  }
};

const assertNotInActiveVoiceRoom = async (userId) => {
  const activeVoiceMembership = await VoiceRoomMemberSession.findOne({
    where: {
      userId: Number(userId),
      status: {
        [Op.in]: ["joining", "connected", "billing"],
      },
    },
    include: [
      {
        model: VoiceRoomSession,
        as: "session",
        required: true,
        where: {
          status: "live",
        },
        include: [
          {
            model: VoiceRoom,
            as: "room",
            required: true,
            where: {
              status: "live",
            },
          },
        ],
      },
    ],
  });

  if (activeVoiceMembership) {
    throw new BattleConflictError(
      "Leave your current voice room before starting or accepting a battle"
    );
  }
};

const assertNotInActiveBattleAsFighter = async (userId) => {
  const activeFighter = await BattleFighter.findOne({
    where: {
      userId: Number(userId),
      status: {
        [Op.in]: ACTIVE_BATTLE_FIGHTER_STATUSES,
      },
      activeFighterGuard: {
        [Op.like]: "fighter:%",
      },
    },
    include: [
      {
        model: BattleRoom,
        as: "battle",
        required: true,
        where: {
          status: {
            [Op.in]: ACTIVE_BATTLE_ROOM_STATUSES,
          },
        },
      },
    ],
  });

  if (activeFighter) {
    throw new BattleConflictError("You are already in an active battle");
  }
};

export const expireStaleBattleInvites = async () => {
  const now = new Date();

  await BattleInvite.update(
    { status: BATTLE_INVITE_STATUSES.EXPIRED },
    {
      where: {
        status: BATTLE_INVITE_STATUSES.PENDING,
        expiresAt: {
          [Op.lt]: now,
        },
      },
    }
  );
};

export const finalizeExpiredLiveBattles = async () => {
  const now = new Date();

  const expiredBattles = await BattleRoom.findAll({
    where: {
      status: BATTLE_ROOM_STATUSES.LIVE,
      endsAt: {
        [Op.lte]: now,
      },
    },
  });

  for (const battle of expiredBattles) {
    await settleBattle(battle.id);
  }
};

export const getBattleFeatureStatus = async () => {
  await ensureBattleSchema();
  const settings = await getBattleSettings();

  return {
    enabled: Boolean(settings.enabled),
    defaultDurationSeconds: settings.defaultDurationSeconds,
    inviteTimeoutSeconds: settings.inviteTimeoutSeconds,
  };
};

export const listBattleOpponents = async (
  challengerId,
  { search = "", limit = 30 } = {}
) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();

  const normalizedChallengerId = Number(challengerId);

  if (!Number.isFinite(normalizedChallengerId) || normalizedChallengerId <= 0) {
    throw new Error("Authentication required");
  }

  const challenger = await User.findByPk(normalizedChallengerId);

  assertFemaleUser(challenger, "Challenger");

  const blockedIds = await getBlockedPeerIds(normalizedChallengerId);
  const excludedIds = [...blockedIds, normalizedChallengerId];
  const normalizedSearch = String(search ?? "").trim();
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 30));

  const sameLevel = await listSameLevelFemaleOpponents(normalizedChallengerId, {
    excludedIds,
    search: normalizedSearch,
    limit: safeLimit,
  });

  const [recentIds, favoriteIds] = await Promise.all([
    listRecentBattleOpponentIds(normalizedChallengerId, safeLimit),
    listFavoriteFemaleOpponentIds(normalizedChallengerId, safeLimit),
  ]);

  const [recent, favorites] = await Promise.all([
    loadOpponentsByIds(recentIds, {
      excludedIds,
      search: normalizedSearch,
      limit: safeLimit,
    }),
    loadOpponentsByIds(favoriteIds, {
      excludedIds,
      search: normalizedSearch,
      limit: safeLimit,
    }),
  ]);

  const sameLevelIds = new Set(sameLevel.map((user) => Number(user.id)));

  return {
    sameLevel,
    online: sameLevel,
    recent: recent.filter((user) => sameLevelIds.has(Number(user.id))),
    favorites: favorites.filter((user) => sameLevelIds.has(Number(user.id))),
  };
};

export const createBattleInvite = async (
  challengerId,
  { opponentId, durationSeconds }
) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();
  await expireStaleBattleInvites();

  const normalizedChallengerId = Number(challengerId);
  const normalizedOpponentId = Number(opponentId);

  if (
    !Number.isFinite(normalizedOpponentId) ||
    normalizedOpponentId <= 0 ||
    normalizedOpponentId === normalizedChallengerId
  ) {
    throw new Error("Invalid opponent");
  }

  if (await isUserInActiveOneToOneCall(normalizedChallengerId)) {
    throw new BattleUserInCallError();
  }

  if (await isUserInActiveOneToOneCall(normalizedOpponentId)) {
    throw new Error("Opponent is currently on a call");
  }

  await assertNotInActiveVoiceRoom(normalizedChallengerId);
  await assertNotInActiveVoiceRoom(normalizedOpponentId);
  await assertNotInActiveBattleAsFighter(normalizedChallengerId);
  await assertNotInActiveBattleAsFighter(normalizedOpponentId);

  const [challenger, opponent] = await Promise.all([
    User.findByPk(normalizedChallengerId),
    User.findByPk(normalizedOpponentId),
  ]);

  assertFemaleUser(challenger, "Challenger");
  assertFemaleUser(opponent, "Opponent");
  await assertSameLevelOpponents(normalizedChallengerId, normalizedOpponentId);

  const settings = await getBattleSettings();
  const resolvedDuration = durationSeconds
    ? Math.min(1800, Math.max(60, Number(durationSeconds)))
    : settings.defaultDurationSeconds;

  const existingPending = await BattleInvite.findOne({
    where: {
      status: BATTLE_INVITE_STATUSES.PENDING,
      [Op.or]: [
        {
          challengerId: normalizedChallengerId,
          opponentId: normalizedOpponentId,
        },
        {
          challengerId: normalizedOpponentId,
          opponentId: normalizedChallengerId,
        },
      ],
    },
  });

  if (existingPending) {
    throw new BattleConflictError("A battle invite is already pending");
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + settings.inviteTimeoutSeconds * 1000
  );

  const invite = await BattleInvite.create({
    challengerId: normalizedChallengerId,
    opponentId: normalizedOpponentId,
    status: BATTLE_INVITE_STATUSES.PENDING,
    durationSeconds: resolvedDuration,
    expiresAt,
  });

  const payload = {
    id: invite.id,
    inviteId: invite.id,
    challengerId: normalizedChallengerId,
    opponentId: normalizedOpponentId,
    durationSeconds: resolvedDuration,
    expiresAt: expiresAt.toISOString(),
    challenger: serializeUserPreview(challenger),
  };

  emitBattleInvite(normalizedOpponentId, payload);

  void notifyIncomingBattleInvite({
    inviteId: invite.id,
    challengerId: normalizedChallengerId,
    opponentId: normalizedOpponentId,
    durationSeconds: resolvedDuration,
    expiresAt: expiresAt.toISOString(),
    challengerName: getBattleUserDisplayName(challenger),
    challengerAvatar: challenger.avatar ?? "",
    challenger: payload.challenger,
  });

  return payload;
};

export const listBattleInvites = async (userId) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();
  await expireStaleBattleInvites();

  const normalizedUserId = Number(userId);
  const invites = await BattleInvite.findAll({
    where: {
      status: {
        [Op.in]: [
          BATTLE_INVITE_STATUSES.PENDING,
          BATTLE_INVITE_STATUSES.ACCEPTED,
        ],
      },
      [Op.or]: [
        { challengerId: normalizedUserId },
        { opponentId: normalizedUserId },
      ],
    },
    order: [["createdAt", "DESC"]],
    limit: 20,
  });

  const userIds = [
    ...new Set(
      invites.flatMap((invite) => [invite.challengerId, invite.opponentId])
    ),
  ];

  const users = userIds.length
    ? await User.findAll({
        where: { id: userIds },
        attributes: ["id", "name", "username", "nickname", "avatar", "gender"],
      })
    : [];

  const userMap = new Map(users.map((user) => [String(user.id), user]));

  return invites.map((invite) => ({
    id: invite.id,
    status: invite.status,
    challengerId: invite.challengerId,
    opponentId: invite.opponentId,
    durationSeconds: invite.durationSeconds,
    expiresAt: invite.expiresAt,
    battleId: invite.battleId,
    challenger: serializeUserPreview(userMap.get(String(invite.challengerId))),
    opponent: serializeUserPreview(userMap.get(String(invite.opponentId))),
    direction:
      Number(invite.challengerId) === normalizedUserId ? "outgoing" : "incoming",
  }));
};

const createBattleFromInvite = async (invite, transaction) => {
  const channelName = getBattleChannelName(`pending_${invite.id}`);
  const now = new Date();
  const endsAt = new Date(now.getTime() + invite.durationSeconds * 1000);

  const battle = await BattleRoom.create(
    {
      inviteId: invite.id,
      status: BATTLE_ROOM_STATUSES.LIVE,
      durationSeconds: invite.durationSeconds,
      agoraChannelName: channelName,
      startsAt: now,
      endsAt,
    },
    { transaction }
  );

  const finalChannelName = getBattleChannelName(battle.id);
  await battle.update({ agoraChannelName: finalChannelName }, { transaction });

  await BattleFighter.bulkCreate(
    [
      {
        battleId: battle.id,
        userId: invite.challengerId,
        slot: BATTLE_FIGHTER_SLOTS.A,
        status: BATTLE_FIGHTER_STATUSES.CONNECTED,
        agoraUid: Number(invite.challengerId),
        activeFighterGuard: buildActiveFighterGuard(invite.challengerId),
        joinedAt: now,
      },
      {
        battleId: battle.id,
        userId: invite.opponentId,
        slot: BATTLE_FIGHTER_SLOTS.B,
        status: BATTLE_FIGHTER_STATUSES.CONNECTED,
        agoraUid: Number(invite.opponentId),
        activeFighterGuard: buildActiveFighterGuard(invite.opponentId),
        joinedAt: now,
      },
    ],
    { transaction }
  );

  await invite.update(
    {
      status: BATTLE_INVITE_STATUSES.ACCEPTED,
      battleId: battle.id,
    },
    { transaction }
  );

  return battle;
};

export const acceptBattleInvite = async (userId, inviteId) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();
  await expireStaleBattleInvites();

  const normalizedUserId = Number(userId);
  const normalizedInviteId = Number(inviteId);

  if (await isUserInActiveOneToOneCall(normalizedUserId)) {
    throw new BattleUserInCallError();
  }

  await assertNotInActiveVoiceRoom(normalizedUserId);
  await assertNotInActiveBattleAsFighter(normalizedUserId);

  const transaction = await sequelize.transaction();

  try {
    const invite = await BattleInvite.findByPk(normalizedInviteId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!invite) {
      throw new Error("Invite not found");
    }

    if (Number(invite.opponentId) !== normalizedUserId) {
      throw new Error("Not allowed to accept this invite");
    }

    if (
      invite.status === BATTLE_INVITE_STATUSES.ACCEPTED &&
      invite.battleId
    ) {
      await transaction.commit();
      return serializeBattleDetail(invite.battleId, normalizedUserId);
    }

    if (invite.status !== BATTLE_INVITE_STATUSES.PENDING) {
      throw new BattleConflictError("Invite is no longer available");
    }

    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      await invite.update(
        { status: BATTLE_INVITE_STATUSES.EXPIRED },
        { transaction }
      );
      throw new BattleConflictError("Invite has expired");
    }

    await assertNotInActiveBattleAsFighter(invite.challengerId);
    await clearStaleFighterLocks(normalizedUserId);
    await clearStaleFighterLocks(invite.challengerId);

    const battle = await createBattleFromInvite(invite, transaction);

    await transaction.commit();

    const detail = await serializeBattleDetail(battle.id, normalizedUserId);

    emitBattleStarted(battle.id, detail);
    emitBattleStateToRoom(battle.id);

    emitBattleInviteAccepted(invite.challengerId, {
      inviteId: invite.id,
      battle: detail,
    });

    emitBattleInviteAccepted(normalizedUserId, {
      inviteId: invite.id,
      battle: detail,
    });

    return detail;
  } catch (error) {
    if (!transaction.finished) {
      await transaction.rollback();
    }

    if (isUniqueConstraintError(error)) {
      throw new BattleConflictError(
        "A previous battle is still locking one of the fighters. Please try again."
      );
    }

    throw error;
  }
};

export const declineBattleInvite = async (userId, inviteId) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();

  const normalizedUserId = Number(userId);
  const invite = await BattleInvite.findByPk(Number(inviteId));

  if (!invite) {
    throw new Error("Invite not found");
  }

  if (Number(invite.opponentId) !== normalizedUserId) {
    throw new Error("Not allowed to decline this invite");
  }

  if (invite.status !== BATTLE_INVITE_STATUSES.PENDING) {
    throw new BattleConflictError("Invite is no longer available");
  }

  await invite.update({ status: BATTLE_INVITE_STATUSES.DECLINED });

  emitBattleInviteDeclined(invite.challengerId, {
    inviteId: invite.id,
    opponentId: normalizedUserId,
  });

  return { inviteId: invite.id, status: BATTLE_INVITE_STATUSES.DECLINED };
};

export const cancelBattleInvite = async (userId, inviteId) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();

  const normalizedUserId = Number(userId);
  const invite = await BattleInvite.findByPk(Number(inviteId));

  if (!invite) {
    throw new Error("Invite not found");
  }

  if (Number(invite.challengerId) !== normalizedUserId) {
    throw new Error("Not allowed to cancel this invite");
  }

  if (invite.status !== BATTLE_INVITE_STATUSES.PENDING) {
    throw new BattleConflictError("Invite is no longer available");
  }

  await invite.update({ status: BATTLE_INVITE_STATUSES.CANCELLED });

  emitBattleInviteDeclined(invite.opponentId, {
    inviteId: invite.id,
    cancelled: true,
    challengerId: normalizedUserId,
  });

  return { inviteId: invite.id, status: BATTLE_INVITE_STATUSES.CANCELLED };
};

export const listLiveBattles = async () => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();
  await finalizeExpiredLiveBattles();

  const battles = await BattleRoom.findAll({
    where: {
      status: {
        [Op.in]: [BATTLE_ROOM_STATUSES.ACCEPTED, BATTLE_ROOM_STATUSES.LIVE],
      },
    },
    include: [
      {
        model: BattleFighter,
        as: "fighters",
      },
    ],
    order: [["updatedAt", "DESC"]],
  });

  const results = [];

  for (const battle of battles) {
    results.push(await serializeBattleDetail(battle.id));
  }

  return results;
};

export const getBattleDetail = async (battleId, viewerUserId = null) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();
  await finalizeExpiredLiveBattles();

  return serializeBattleDetail(battleId, viewerUserId);
};

const tryStartBattleIfReady = async (battleId) => {
  const battle = await BattleRoom.findByPk(battleId, {
    include: [{ model: BattleFighter, as: "fighters" }],
  });

  if (!battle || battle.status !== BATTLE_ROOM_STATUSES.ACCEPTED) {
    return battle;
  }

  const fighters = battle.fighters ?? [];
  const allConnected = fighters.length === 2 &&
    fighters.every((fighter) => fighter.status === BATTLE_FIGHTER_STATUSES.CONNECTED);

  if (!allConnected) {
    return battle;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + battle.durationSeconds * 1000);

  await battle.update({
    status: BATTLE_ROOM_STATUSES.LIVE,
    startsAt: now,
    endsAt,
  });

  const detail = await serializeBattleDetail(battle.id);
  emitBattleStarted(battle.id, detail);
  emitBattleStateToRoom(battle.id);

  return battle;
};

export const joinBattleAsFighter = async (userId, battleId) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();

  const normalizedUserId = Number(userId);
  const normalizedBattleId = Number(battleId);

  if (await isUserInActiveOneToOneCall(normalizedUserId)) {
    throw new BattleUserInCallError();
  }

  const fighter = await BattleFighter.findOne({
    where: {
      battleId: normalizedBattleId,
      userId: normalizedUserId,
    },
  });

  if (!fighter) {
    throw new Error("You are not a fighter in this battle");
  }

  if (fighter.status === BATTLE_FIGHTER_STATUSES.LEFT) {
    throw new BattleConflictError("You have already left this battle");
  }

  if (fighter.status !== BATTLE_FIGHTER_STATUSES.CONNECTED) {
    await fighter.update({
      status: BATTLE_FIGHTER_STATUSES.CONNECTED,
      joinedAt: new Date(),
    });
  }

  await tryStartBattleIfReady(normalizedBattleId);

  const detail = await serializeBattleDetail(normalizedBattleId, normalizedUserId);
  emitBattleStateToRoom(normalizedBattleId);

  return detail;
};

export const joinBattleAsAudience = async (userId, battleId) => {
  await assertBattleFeatureEnabled();
  await ensureBattleSchema();
  await finalizeExpiredLiveBattles();

  const normalizedUserId = Number(userId);
  const normalizedBattleId = Number(battleId);

  const battle = await BattleRoom.findByPk(normalizedBattleId);

  if (!battle) {
    throw new Error("Battle not found");
  }

  if (
    battle.status !== BATTLE_ROOM_STATUSES.LIVE &&
    battle.status !== BATTLE_ROOM_STATUSES.ACCEPTED
  ) {
    throw new Error("Battle is not joinable");
  }

  const user = await User.findByPk(normalizedUserId);

  if (!user) {
    throw new Error("User not found");
  }

  if (String(user.gender || "").toLowerCase() === "female") {
    throw new Error("Female users join battles as fighters, not audience");
  }

  const existing = await BattleAudienceSession.findOne({
    where: {
      battleId: normalizedBattleId,
      userId: normalizedUserId,
      status: {
        [Op.in]: ["joining", "connected"],
      },
    },
  });

  if (existing) {
    await tryStartBattleIfReady(normalizedBattleId);
    return serializeBattleDetail(normalizedBattleId, normalizedUserId);
  }

  await BattleAudienceSession.create({
    battleId: normalizedBattleId,
    userId: normalizedUserId,
    status: BATTLE_AUDIENCE_STATUSES.CONNECTED,
    joinedAt: new Date(),
  });

  await tryStartBattleIfReady(normalizedBattleId);

  const displayName = getBattleUserDisplayName(user);

  emitBattleAudienceJoined(normalizedBattleId, {
    battleId: normalizedBattleId,
    userId: normalizedUserId,
    displayName,
    entryEffectId: resolveVisibleEntryEffectId(user),
    user: {
      id: user.id,
      name: displayName,
      avatar: user.avatar ?? null,
      gender: user.gender ?? null,
    },
  });

  emitBattleStateToRoom(normalizedBattleId);

  return serializeBattleDetail(normalizedBattleId, normalizedUserId);
};

export const leaveBattleAudience = async (userId, battleId) => {
  await assertBattleFeatureEnabled();

  const normalizedUserId = Number(userId);
  const normalizedBattleId = Number(battleId);

  const session = await BattleAudienceSession.findOne({
    where: {
      battleId: normalizedBattleId,
      userId: normalizedUserId,
      status: {
        [Op.in]: ["joining", "connected"],
      },
    },
  });

  if (!session) {
    return serializeBattleDetail(normalizedBattleId, normalizedUserId);
  }

  await session.update({
    status: BATTLE_AUDIENCE_STATUSES.LEFT,
    leftAt: new Date(),
  });

  emitBattleStateToRoom(normalizedBattleId);

  return serializeBattleDetail(normalizedBattleId, normalizedUserId);
};

export const settleBattle = async (battleId) => {
  const battle = await BattleRoom.findByPk(Number(battleId), {
    include: [{ model: BattleFighter, as: "fighters" }],
  });

  if (!battle) {
    throw new Error("Battle not found");
  }

  if (
    battle.status === BATTLE_ROOM_STATUSES.SETTLED ||
    battle.status === BATTLE_ROOM_STATUSES.CANCELLED
  ) {
    return serializeBattleDetail(battle.id);
  }

  if (battle.status === BATTLE_ROOM_STATUSES.ACCEPTED) {
    const now = new Date();
    await battle.update({ status: BATTLE_ROOM_STATUSES.CANCELLED });

    for (const fighter of battle.fighters ?? []) {
      await releaseFighterLock(fighter, now);
    }

    return serializeBattleDetail(battle.id);
  }

  const fighters = battle.fighters ?? [];
  const fighterA = fighters.find((f) => f.slot === BATTLE_FIGHTER_SLOTS.A);
  const fighterB = fighters.find((f) => f.slot === BATTLE_FIGHTER_SLOTS.B);

  let winnerFighterId = null;

  if (fighterA && fighterB) {
    const scoreA = Number(fighterA.scoreCoins) || 0;
    const scoreB = Number(fighterB.scoreCoins) || 0;

    if (scoreA > scoreB) {
      winnerFighterId = fighterA.id;
    } else if (scoreB > scoreA) {
      winnerFighterId = fighterB.id;
    }
  }

  const now = new Date();

  await battle.update({
    status: BATTLE_ROOM_STATUSES.SETTLED,
    settledAt: now,
    winnerFighterId,
  });

  for (const fighter of fighters) {
    if (fighter.status !== BATTLE_FIGHTER_STATUSES.LEFT) {
      await fighter.update({
        status: BATTLE_FIGHTER_STATUSES.LEFT,
        leftAt: now,
        activeFighterGuard: buildReleasedFighterGuard(fighter.id),
      });
    }
  }

  await BattleAudienceSession.update(
    {
      status: BATTLE_AUDIENCE_STATUSES.LEFT,
      leftAt: now,
    },
    {
      where: {
        battleId: battle.id,
        status: {
          [Op.in]: ["joining", "connected"],
        },
      },
    }
  );

  const detail = await serializeBattleDetail(battle.id);
  emitBattleEnded(battle.id, detail);
  emitBattleScore(battle.id, detail);

  return detail;
};

export const adminForceCloseBattle = async (battleId) => {
  await ensureBattleSchema();
  await finalizeExpiredLiveBattles();

  const battle = await BattleRoom.findByPk(Number(battleId));

  if (!battle) {
    throw new Error("Battle not found");
  }

  if (battle.status === BATTLE_ROOM_STATUSES.LIVE) {
    await battle.update({ status: BATTLE_ROOM_STATUSES.ENDED });
  }

  return settleBattle(battle.id);
};

export const listAdminLiveBattles = async () => {
  await ensureBattleSchema();
  await finalizeExpiredLiveBattles();
  return listLiveBattles();
};

export {
  buildActiveFighterGuard,
  buildReleasedFighterGuard,
};
