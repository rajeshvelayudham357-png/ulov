import { Op } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  Earning,
  FemaleScratchReward,
  FemaleScratchRewardClaim,
  User,
  Wallet,
  WalletTransaction,
} from "../models/index.js";

export const MIN_SCRATCH_DURATION_SECONDS = 0;
export const MAX_SCRATCH_DURATION_SECONDS = 60;
export const MIN_SCRATCH_REWARD_COINS = 1;
export const MAX_SCRATCH_REWARD_COINS = 100000;
export const FEMALE_SCRATCH_REWARD_EVENT = "female-scratch-reward";

let ioRef = null;
let onlineUsersRef = null;
let schemaReady = false;

export const initFemaleScratchRewardRealtime = (io, onlineUsers) => {
  ioRef = io;
  onlineUsersRef = onlineUsers;
};

export const clampDurationSeconds = (value) => {
  const seconds = Math.round(Number(value));

  if (!Number.isFinite(seconds)) {
    return null;
  }

  return Math.min(
    MAX_SCRATCH_DURATION_SECONDS,
    Math.max(MIN_SCRATCH_DURATION_SECONDS, seconds)
  );
};

export const clampRewardCoins = (value) => {
  const coins = Math.round(Number(value));

  if (!Number.isFinite(coins) || coins < MIN_SCRATCH_REWARD_COINS) {
    return null;
  }

  return Math.min(MAX_SCRATCH_REWARD_COINS, coins);
};

export const isScratchRewardExpired = (expiresAt, now = Date.now()) => {
  const expiresMs = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiresMs)) {
    return true;
  }

  return now >= expiresMs;
};

export const remainingSeconds = (expiresAt, now = Date.now()) => {
  const expiresMs = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiresMs)) {
    return 0;
  }

  return Math.max(0, Math.ceil((expiresMs - now) / 1000));
};

export const earningAmountForCoins = (coins) => Number(coins || 0) / 2;

export const serializeScratchRewardForClient = (reward, now = Date.now()) => {
  if (!reward) {
    return null;
  }

  const data = reward.toJSON ? reward.toJSON() : reward;
  const expiresAt = data.expiresAt
    ? new Date(data.expiresAt).toISOString()
    : null;

  if (!expiresAt || isScratchRewardExpired(expiresAt, now)) {
    return null;
  }

  return {
    id: Number(data.id),
    rewardCoins: Number(data.rewardCoins) || 0,
    durationSeconds: Number(data.durationSeconds) || 0,
    expiresAt,
    sentAt: data.createdAt ? new Date(data.createdAt).toISOString() : null,
    remainingSeconds: remainingSeconds(expiresAt, now),
  };
};

const isFemaleUser = (user) => {
  const gender = String(user?.gender || "").trim().toLowerCase();
  return gender === "female";
};

const emitToUser = (userId, event, payload) => {
  if (!ioRef || !onlineUsersRef) {
    return false;
  }

  const keys = [
    ...new Set(
      [userId, String(userId), Number(userId)]
        .filter((value) => value !== undefined && value !== null && value !== "")
        .map((value) => String(value))
    ),
  ];

  let emitted = false;

  for (const key of keys) {
    const socketId = onlineUsersRef.get(key);

    if (!socketId) {
      continue;
    }

    ioRef.to(socketId).emit(event, payload);
    emitted = true;
  }

  return emitted;
};

export const ensureFemaleScratchRewardSchema = async () => {
  if (schemaReady) {
    return;
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS female_scratch_rewards (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      rewardCoins INT NOT NULL,
      durationSeconds INT NOT NULL DEFAULT 30,
      expiresAt DATETIME NOT NULL,
      targetType VARCHAR(20) NOT NULL DEFAULT 'all',
      targetUserIds JSON NULL,
      sentCount INT NOT NULL DEFAULT 0,
      claimedCount INT NOT NULL DEFAULT 0,
      createdByAdminId BIGINT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS female_scratch_reward_claims (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      rewardId BIGINT NOT NULL,
      userId BIGINT NOT NULL,
      coins INT NOT NULL,
      claimedAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_female_scratch_reward_claim (rewardId, userId)
    )
  `);

  schemaReady = true;
};

const femaleUserWhere = {
  gender: {
    [Op.in]: ["Female", "female"],
  },
};

const serializeNotifyUser = (user) => {
  const data = user.toJSON ? user.toJSON() : user;

  return {
    id: data.id,
    publicUserId: data.publicUserId,
    displayName:
      data.nickname || data.username || data.name || `User ${data.id}`,
    phone: data.phone,
    email: data.email,
    gender: data.gender,
    avatar: data.avatar,
    online: Boolean(data.online),
    accountStatus: data.accountStatus,
    createdAt: data.createdAt,
  };
};

export const listFemaleScratchRewardUsers = async (search = "") => {
  await ensureFemaleScratchRewardSchema();

  const where = { ...femaleUserWhere };
  const query = String(search || "").trim();

  if (query) {
    where[Op.and] = [
      {
        [Op.or]: [
          { name: { [Op.like]: `%${query}%` } },
          { nickname: { [Op.like]: `%${query}%` } },
          { username: { [Op.like]: `%${query}%` } },
          { publicUserId: { [Op.like]: `%${query}%` } },
          { phone: { [Op.like]: `%${query}%` } },
          { email: { [Op.like]: `%${query}%` } },
        ],
      },
    ];
  }

  const users = await User.findAll({
    where,
    attributes: [
      "id",
      "publicUserId",
      "username",
      "name",
      "nickname",
      "phone",
      "email",
      "gender",
      "avatar",
      "online",
      "accountStatus",
      "createdAt",
    ],
    order: [["createdAt", "DESC"]],
    limit: 500,
  });

  return users.map(serializeNotifyUser);
};

const resolveTargetUsers = async ({ mode, userIds, search }) => {
  if (mode === "users") {
    const ids = [
      ...new Set(
        (Array.isArray(userIds) ? userIds : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      ),
    ];

    if (!ids.length) {
      return [];
    }

    const users = await User.findAll({
      where: {
        id: { [Op.in]: ids },
        ...femaleUserWhere,
      },
      attributes: ["id", "gender", "username", "name", "nickname"],
    });

    return users.filter(isFemaleUser);
  }

  const where = { ...femaleUserWhere };
  const query = String(search || "").trim();

  if (query) {
    where[Op.and] = [
      {
        [Op.or]: [
          { name: { [Op.like]: `%${query}%` } },
          { nickname: { [Op.like]: `%${query}%` } },
          { username: { [Op.like]: `%${query}%` } },
          { publicUserId: { [Op.like]: `%${query}%` } },
          { phone: { [Op.like]: `%${query}%` } },
          { email: { [Op.like]: `%${query}%` } },
        ],
      },
    ];
  }

  return User.findAll({
    where,
    attributes: ["id", "gender", "username", "name", "nickname"],
  });
};

const parseTargetUserIds = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

export const isScratchRewardTargetedAtUser = (reward, userId) => {
  const targetType = String(reward?.targetType || "all").toLowerCase();

  if (targetType !== "users") {
    return true;
  }

  return parseTargetUserIds(reward?.targetUserIds).some(
    (value) => Number(value) === Number(userId)
  );
};

export const isMissedScratchRewardForUser = ({
  reward,
  userId,
  userCreatedAt,
  claimedRewardIds = new Set(),
  now = Date.now(),
}) => {
  if (!reward || !isScratchRewardExpired(reward.expiresAt, now)) {
    return false;
  }

  const rewardCreatedMs = new Date(reward.createdAt || 0).getTime();
  const userCreatedMs = new Date(userCreatedAt || 0).getTime();

  if (
    Number.isFinite(rewardCreatedMs) &&
    Number.isFinite(userCreatedMs) &&
    rewardCreatedMs < userCreatedMs
  ) {
    return false;
  }

  if (!isScratchRewardTargetedAtUser(reward, userId)) {
    return false;
  }

  return !claimedRewardIds.has(Number(reward.id));
};

const userIsTargeted = isScratchRewardTargetedAtUser;

export const sendFemaleScratchReward = async ({
  coins,
  durationSeconds,
  mode = "all",
  userIds,
  search,
  adminId,
}) => {
  await ensureFemaleScratchRewardSchema();

  const rewardCoins = clampRewardCoins(coins);
  const duration = clampDurationSeconds(durationSeconds);

  if (rewardCoins == null) {
    throw new Error("Reward coins must be at least 1");
  }

  if (duration == null) {
    throw new Error("Duration must be between 0 and 60 seconds");
  }

  const targetMode = mode === "users" ? "users" : "all";
  const users = await resolveTargetUsers({
    mode: targetMode,
    userIds,
    search,
  });

  if (!users.length) {
    throw new Error("No matching female users found");
  }

  const sentAt = new Date();
  const expiresAt = new Date(sentAt.getTime() + duration * 1000);
  const ids = users.map((user) => Number(user.id));

  const record = await FemaleScratchReward.create({
    rewardCoins,
    durationSeconds: duration,
    expiresAt,
    targetType: targetMode,
    targetUserIds: targetMode === "users" ? ids : null,
    sentCount: ids.length,
    claimedCount: 0,
    createdByAdminId: adminId || null,
  });

  const payload = serializeScratchRewardForClient(record, sentAt.getTime());
  let emittedCount = 0;

  if (payload) {
    for (const userId of ids) {
      if (emitToUser(userId, FEMALE_SCRATCH_REWARD_EVENT, payload)) {
        emittedCount += 1;
      }
    }
  }

  return {
    id: Number(record.id),
    rewardCoins,
    durationSeconds: duration,
    expiresAt: expiresAt.toISOString(),
    targetType: targetMode,
    targetUserIds: targetMode === "users" ? ids : null,
    sentCount: ids.length,
    emittedCount,
    claimedCount: 0,
    createdAt: record.createdAt,
  };
};

export const listFemaleScratchRewards = async () => {
  await ensureFemaleScratchRewardSchema();

  const rows = await FemaleScratchReward.findAll({
    order: [["createdAt", "DESC"]],
    limit: 200,
  });

  return rows.map((row) => serializeScratchRewardForAdmin(row));
};

const serializeScratchRewardForAdmin = (row, now = Date.now()) => {
  const data = row.toJSON ? row.toJSON() : row;
  const expired = isScratchRewardExpired(data.expiresAt, now);

  return {
    id: Number(data.id),
    rewardCoins: Number(data.rewardCoins) || 0,
    durationSeconds: Number(data.durationSeconds) || 0,
    expiresAt: data.expiresAt,
    targetType: data.targetType,
    targetUserIds: data.targetUserIds,
    sentCount: Number(data.sentCount) || 0,
    claimedCount: Number(data.claimedCount) || 0,
    status: expired ? "expired" : "active",
    createdAt: data.createdAt,
  };
};

export const getFemaleScratchRewardClaims = async (rewardId) => {
  await ensureFemaleScratchRewardSchema();

  const numericRewardId = Number(rewardId);

  if (!Number.isFinite(numericRewardId) || numericRewardId <= 0) {
    throw new Error("Valid reward id is required");
  }

  const reward = await FemaleScratchReward.findByPk(numericRewardId);

  if (!reward) {
    throw new Error("Reward not found");
  }

  const claims = await FemaleScratchRewardClaim.findAll({
    where: {
      rewardId: numericRewardId,
    },
    order: [["claimedAt", "DESC"]],
  });

  const userIds = [
    ...new Set(
      claims
        .map((row) => Number(row.userId))
        .filter((value) => Number.isFinite(value))
    ),
  ];

  const users = userIds.length
    ? await User.findAll({
        where: {
          id: {
            [Op.in]: userIds,
          },
        },
        attributes: [
          "id",
          "publicUserId",
          "username",
          "name",
          "nickname",
          "phone",
          "email",
          "avatar",
          "online",
          "accountStatus",
        ],
      })
    : [];

  const userMap = new Map(
    users.map((user) => [Number(user.id), serializeNotifyUser(user)])
  );

  const rows = claims.map((claim) => {
    const data = claim.toJSON();
    const user = userMap.get(Number(data.userId));

    return {
      id: Number(data.id),
      userId: Number(data.userId),
      displayName: user?.displayName || `User ${data.userId}`,
      publicUserId: user?.publicUserId || null,
      phone: user?.phone || "",
      email: user?.email || "",
      avatar: user?.avatar || null,
      online: Boolean(user?.online),
      accountStatus: user?.accountStatus || "",
      coins: Number(data.coins) || Number(reward.rewardCoins) || 0,
      claimedAt: data.claimedAt || data.createdAt,
    };
  });

  const claimedCoins = rows.reduce(
    (sum, row) => sum + Number(row.coins || 0),
    0
  );

  return {
    reward: serializeScratchRewardForAdmin(reward),
    summary: {
      sentCount: Number(reward.sentCount) || 0,
      claimedCount: rows.length,
      claimedCoins,
    },
    rows,
  };
};

export const getActiveScratchRewardForUser = async (userId) => {
  await ensureFemaleScratchRewardSchema();

  const numericUserId = Number(userId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error("Valid user id is required");
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "gender"],
  });

  if (!user || !isFemaleUser(user)) {
    return null;
  }

  const now = new Date();

  const rewards = await FemaleScratchReward.findAll({
    where: {
      expiresAt: {
        [Op.gt]: now,
      },
    },
    order: [["createdAt", "DESC"]],
    limit: 20,
  });

  if (!rewards.length) {
    return null;
  }

  const claimed = await FemaleScratchRewardClaim.findAll({
    where: {
      userId: numericUserId,
      rewardId: {
        [Op.in]: rewards.map((row) => row.id),
      },
    },
    attributes: ["rewardId"],
  });

  const claimedIds = new Set(
    claimed.map((row) => Number(row.rewardId))
  );

  const match = rewards.find(
    (reward) =>
      userIsTargeted(reward, numericUserId) &&
      !claimedIds.has(Number(reward.id))
  );

  return serializeScratchRewardForClient(match);
};

export const claimFemaleScratchReward = async (userId, rewardId) => {
  await ensureFemaleScratchRewardSchema();

  const numericUserId = Number(userId);
  const numericRewardId = Number(rewardId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error("Valid user id is required");
  }

  if (!Number.isFinite(numericRewardId) || numericRewardId <= 0) {
    throw new Error("Valid reward id is required");
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "gender"],
  });

  if (!user || !isFemaleUser(user)) {
    throw new Error("This reward is only for female users");
  }

  const transaction = await sequelize.transaction();

  try {
    const reward = await FemaleScratchReward.findByPk(numericRewardId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!reward) {
      throw new Error("Reward not found");
    }

    if (!userIsTargeted(reward, numericUserId)) {
      throw new Error("Reward not found");
    }

    if (isScratchRewardExpired(reward.expiresAt)) {
      throw new Error("This reward has expired");
    }

    const existing = await FemaleScratchRewardClaim.findOne({
      where: {
        rewardId: numericRewardId,
        userId: numericUserId,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existing) {
      throw new Error("Reward already claimed");
    }

    const coins = Number(reward.rewardCoins) || 0;
    const claimedAt = new Date();

    await FemaleScratchRewardClaim.create(
      {
        rewardId: numericRewardId,
        userId: numericUserId,
        coins,
        claimedAt,
      },
      { transaction }
    );

    let wallet = await Wallet.findOne({
      where: { userId: numericUserId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!wallet) {
      wallet = await Wallet.create(
        {
          userId: numericUserId,
          balance: 0,
        },
        { transaction }
      );
    }

    wallet.balance = Number(wallet.balance ?? 0) + coins;
    await wallet.save({ transaction });

    await WalletTransaction.create(
      {
        userId: numericUserId,
        type: "scratch_reward",
        amount: coins,
        description: "Female scratch card reward",
        referenceId: numericRewardId,
        referenceType: "female_scratch_reward",
      },
      { transaction }
    );

    await Earning.create(
      {
        userId: numericUserId,
        callId: null,
        coins,
        amount: earningAmountForCoins(coins),
        duration: 0,
        status: "paid",
      },
      { transaction }
    );

    await reward.update(
      {
        claimedCount: Number(reward.claimedCount || 0) + 1,
      },
      { transaction }
    );

    await transaction.commit();

    return {
      success: true,
      rewardId: numericRewardId,
      rewardCoins: coins,
      walletBalance: wallet.balance,
      earningAmount: earningAmountForCoins(coins),
      message: "Reward claimed successfully",
    };
  } catch (error) {
    await transaction.rollback();

    if (String(error?.message ?? "").includes("unique_female_scratch_reward_claim")) {
      throw new Error("Reward already claimed");
    }

    throw error;
  }
};

export const getMissedScratchRewardsForUser = async (
  userId,
  { since } = {}
) => {
  await ensureFemaleScratchRewardSchema();

  const numericUserId = Number(userId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error("Valid user id is required");
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "gender", "createdAt"],
  });

  if (!user || !isFemaleUser(user)) {
    return {
      totalMissed: 0,
      missedRewards: [],
    };
  }

  const now = new Date();
  const where = {
    expiresAt: {
      [Op.lt]: now,
    },
    createdAt: {
      [Op.gte]: user.createdAt,
    },
  };

  if (since) {
    const sinceDate = new Date(since);

    if (!Number.isNaN(sinceDate.getTime())) {
      where.expiresAt = {
        [Op.and]: [
          { [Op.lt]: now },
          { [Op.gt]: sinceDate },
        ],
      };
    }
  }

  const rewards = await FemaleScratchReward.findAll({
    where,
    order: [["expiresAt", "DESC"]],
    limit: 200,
  });

  const targeted = rewards.filter((reward) =>
    isScratchRewardTargetedAtUser(reward, numericUserId)
  );

  const claimed = targeted.length
    ? await FemaleScratchRewardClaim.findAll({
        where: {
          userId: numericUserId,
          rewardId: {
            [Op.in]: targeted.map((row) => row.id),
          },
        },
        attributes: ["rewardId"],
      })
    : [];

  const claimedIds = new Set(claimed.map((row) => Number(row.rewardId)));
  const missed = targeted.filter(
    (reward) => !claimedIds.has(Number(reward.id))
  );

  return {
    totalMissed: missed.length,
    missedRewards: missed.map((reward) => {
      const data = reward.toJSON();

      return {
        id: Number(data.id),
        rewardCoins: Number(data.rewardCoins) || 0,
        durationSeconds: Number(data.durationSeconds) || 0,
        expiresAt: data.expiresAt,
        sentAt: data.createdAt,
      };
    }),
  };
};
