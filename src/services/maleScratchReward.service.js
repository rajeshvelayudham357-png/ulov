import { Op } from "sequelize";

import { sequelize } from "../config/database.js";
import { getAllPurchasablePackages, resolveGoldPackageById } from "../constants/goldPackages.js";
import {
  MaleScratchReward,
  MaleScratchRewardClaim,
  PaymentOrder,
  User,
  Wallet,
  WalletTransaction,
} from "../models/index.js";
import { ensureColumn } from "./schemaUtil.service.js";

export const MIN_SCRATCH_DURATION_SECONDS = 0;
export const MAX_SCRATCH_DURATION_SECONDS = 60;
export const MIN_SCRATCH_REWARD_COINS = 1;
export const MAX_SCRATCH_REWARD_COINS = 100000;
export const MIN_RECHARGE_EXPIRY_HOURS = 1;
export const MAX_RECHARGE_EXPIRY_HOURS = 168;
export const DEFAULT_RECHARGE_EXPIRY_HOURS = 24;
export const MALE_SCRATCH_REWARD_EVENT = "male-scratch-reward";
export const MALE_SCRATCH_REWARD_CLAIMED_EVENT = "male-scratch-reward-claimed";
export const PAID_ORDER_STATUSES = ["PAID", "SUCCESS", "CAPTURED", "credited"];

let ioRef = null;
let onlineUsersRef = null;
let schemaReady = false;

export const initMaleScratchRewardRealtime = (io, onlineUsers) => {
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

export const clampRechargeExpiryHours = (value) => {
  const hours = Math.round(Number(value));

  if (!Number.isFinite(hours)) {
    return DEFAULT_RECHARGE_EXPIRY_HOURS;
  }

  return Math.min(
    MAX_RECHARGE_EXPIRY_HOURS,
    Math.max(MIN_RECHARGE_EXPIRY_HOURS, hours)
  );
};

export const buildRechargeExpiresAt = (fromDate, hours, now = new Date()) => {
  const start = fromDate ? new Date(fromDate) : now;
  const startMs = start.getTime();
  const windowHours = clampRechargeExpiryHours(hours);

  if (!Number.isFinite(startMs)) {
    return new Date(now.getTime() + windowHours * 60 * 60 * 1000);
  }

  return new Date(startMs + windowHours * 60 * 60 * 1000);
};

export const resolveClaimRechargeExpiresAt = (claim, reward, now = new Date()) => {
  if (claim?.rechargeExpiresAt) {
    return new Date(claim.rechargeExpiresAt);
  }

  return buildRechargeExpiresAt(
    claim?.claimedAt || now,
    reward?.rechargeExpiryHours,
    now
  );
};

export const isRechargeClaimExpired = (rechargeExpiresAt, now = Date.now()) => {
  const expiresMs = new Date(rechargeExpiresAt).getTime();

  if (!Number.isFinite(expiresMs)) {
    return false;
  }

  return now >= expiresMs;
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

export const purchaseMatchesRequiredPackage = ({
  packageId,
  coins,
  amount,
  requiredPackageId,
  requiredPackageCoins,
  requiredPackagePrice,
}) => {
  if (Number(packageId) === Number(requiredPackageId)) {
    return true;
  }

  return (
    Number(coins) === Number(requiredPackageCoins) &&
    Number(amount) === Number(requiredPackagePrice)
  );
};

const isMaleUser = (user) => String(user?.gender || "").trim().toLowerCase() === "male";

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

export const ensureMaleScratchRewardSchema = async () => {
  if (schemaReady) {
    return;
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS male_scratch_rewards (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      rewardCoins INT NOT NULL,
      durationSeconds INT NOT NULL DEFAULT 30,
      expiresAt DATETIME NOT NULL,
      rechargeExpiryHours INT NOT NULL DEFAULT 24,
      requiredPackageId INT NOT NULL,
      requiredPackageCoins INT NOT NULL DEFAULT 0,
      requiredPackagePrice FLOAT NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS male_scratch_reward_claims (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      rewardId BIGINT NOT NULL,
      userId BIGINT NOT NULL,
      coins INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      claimedAt DATETIME NOT NULL,
      paidAt DATETIME NULL,
      rechargeExpiresAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_male_scratch_reward_claim (rewardId, userId)
    )
  `);

  await ensureColumn(
    "male_scratch_rewards",
    "rechargeExpiryHours",
    "INT NOT NULL DEFAULT 24"
  );
  await ensureColumn(
    "male_scratch_reward_claims",
    "rechargeExpiresAt",
    "DATETIME NULL"
  );

  schemaReady = true;
};

const maleUserWhere = {
  gender: {
    [Op.in]: ["Male", "male"],
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

const requiredPackageSnapshot = (reward) => ({
  id: Number(reward.requiredPackageId),
  coins: Number(reward.requiredPackageCoins) || 0,
  price: Number(reward.requiredPackagePrice) || 0,
  label: `${Number(reward.requiredPackageCoins) || 0} coins · ₹${Number(reward.requiredPackagePrice) || 0}`,
});

export const listMaleScratchPackages = async () => {
  const { regular, bonus } = await getAllPurchasablePackages();

  return [...regular, ...bonus].map((pack) => ({
    id: Number(pack.id),
    coins: Number(pack.coins) || 0,
    price: Number(pack.price) || 0,
    badge: pack.badge || null,
    label: `${Number(pack.coins) || 0} coins · ₹${Number(pack.price) || 0}`,
  }));
};

export const listMaleScratchRewardUsers = async (search = "") => {
  await ensureMaleScratchRewardSchema();

  const where = { ...maleUserWhere };
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

    return User.findAll({
      where: {
        id: { [Op.in]: ids },
        ...maleUserWhere,
      },
      attributes: ["id", "gender", "username", "name", "nickname"],
    });
  }

  const where = { ...maleUserWhere };
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

const serializeScratchRewardForAdmin = (row, now = Date.now()) => {
  const data = row.toJSON ? row.toJSON() : row;
  const expired = isScratchRewardExpired(data.expiresAt, now);

  return {
    id: Number(data.id),
    rewardCoins: Number(data.rewardCoins) || 0,
    durationSeconds: Number(data.durationSeconds) || 0,
    rechargeExpiryHours: clampRechargeExpiryHours(data.rechargeExpiryHours),
    expiresAt: data.expiresAt,
    requiredPackageId: Number(data.requiredPackageId),
    requiredPackageCoins: Number(data.requiredPackageCoins) || 0,
    requiredPackagePrice: Number(data.requiredPackagePrice) || 0,
    requiredPackage: requiredPackageSnapshot(data),
    targetType: data.targetType,
    targetUserIds: data.targetUserIds,
    sentCount: Number(data.sentCount) || 0,
    claimedCount: Number(data.claimedCount) || 0,
    status: expired ? "expired" : "active",
    createdAt: data.createdAt,
  };
};

const hasQualifyingRecharge = async (userId, reward) => {
  const orders = await PaymentOrder.findAll({
    where: {
      userId,
      status: {
        [Op.in]: PAID_ORDER_STATUSES,
      },
      updatedAt: {
        [Op.gte]: reward.createdAt,
      },
    },
    attributes: ["id", "packageId", "coins", "amount", "status", "updatedAt"],
    order: [["updatedAt", "DESC"]],
    limit: 40,
  });

  return orders.some((order) =>
    purchaseMatchesRequiredPackage({
      packageId: order.packageId,
      coins: order.coins,
      amount: order.amount,
      requiredPackageId: reward.requiredPackageId,
      requiredPackageCoins: reward.requiredPackageCoins,
      requiredPackagePrice: reward.requiredPackagePrice,
    })
  );
};

export const serializeScratchRewardForClient = async (
  reward,
  userId,
  claim = null,
  now = Date.now()
) => {
  if (!reward) {
    return null;
  }

  const data = reward.toJSON ? reward.toJSON() : reward;
  const status = String(claim?.status || "").toLowerCase();

  if (status === "paid") {
    return null;
  }

  const expired = isScratchRewardExpired(data.expiresAt, now);

  if (expired && status !== "pending") {
    return null;
  }

  if (status === "expired") {
    return null;
  }

  const rechargeExpiresAt =
    status === "pending" ? resolveClaimRechargeExpiresAt(claim, data, new Date(now)) : null;

  if (status === "pending" && rechargeExpiresAt && isRechargeClaimExpired(rechargeExpiresAt, now)) {
    if (claim?.id && String(claim.status).toLowerCase() === "pending") {
      await claim.update({
        status: "expired",
        rechargeExpiresAt,
      });
    }

    return null;
  }

  const hasRecharged = await hasQualifyingRecharge(userId, data);

  return {
    id: Number(data.id),
    rewardCoins: Number(data.rewardCoins) || 0,
    durationSeconds: Number(data.durationSeconds) || 0,
    rechargeExpiryHours: clampRechargeExpiryHours(data.rechargeExpiryHours),
    expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : null,
    sentAt: data.createdAt ? new Date(data.createdAt).toISOString() : null,
    remainingSeconds: remainingSeconds(data.expiresAt, now),
    requiredPackage: requiredPackageSnapshot(data),
    hasRecharged,
    claimStatus: status || null,
    rechargeExpiresAt: rechargeExpiresAt ? rechargeExpiresAt.toISOString() : null,
    rechargeRemainingSeconds: rechargeExpiresAt
      ? remainingSeconds(rechargeExpiresAt, now)
      : 0,
  };
};

export const sendMaleScratchReward = async ({
  coins,
  durationSeconds,
  packageId,
  rechargeExpiryHours,
  mode = "all",
  userIds,
  search,
  adminId,
}) => {
  await ensureMaleScratchRewardSchema();

  const rewardCoins = clampRewardCoins(coins);
  const duration = clampDurationSeconds(durationSeconds);
  const rechargeHours = clampRechargeExpiryHours(rechargeExpiryHours);
  const goldPackage = await resolveGoldPackageById(packageId);

  if (rewardCoins == null) {
    throw new Error("Reward coins must be at least 1");
  }

  if (duration == null) {
    throw new Error("Duration must be between 0 and 60 seconds");
  }

  if (!goldPackage) {
    throw new Error("Select a recharge package users must buy to claim");
  }

  const targetMode = mode === "users" ? "users" : "all";
  const users = await resolveTargetUsers({
    mode: targetMode,
    userIds,
    search,
  });

  if (!users.length) {
    throw new Error("No matching male users found");
  }

  const sentAt = new Date();
  const expiresAt = new Date(sentAt.getTime() + duration * 1000);
  const ids = users.map((user) => Number(user.id));

  const record = await MaleScratchReward.create({
    rewardCoins,
    durationSeconds: duration,
    expiresAt,
    rechargeExpiryHours: rechargeHours,
    requiredPackageId: goldPackage.id,
    requiredPackageCoins: goldPackage.coins,
    requiredPackagePrice: goldPackage.price,
    targetType: targetMode,
    targetUserIds: targetMode === "users" ? ids : null,
    sentCount: ids.length,
    claimedCount: 0,
    createdByAdminId: adminId || null,
  });

  const payloadBase = {
    id: Number(record.id),
    rewardCoins,
    durationSeconds: duration,
    rechargeExpiryHours: rechargeHours,
    expiresAt: expiresAt.toISOString(),
    sentAt: sentAt.toISOString(),
    remainingSeconds: duration,
    requiredPackage: requiredPackageSnapshot(record),
    hasRecharged: false,
    claimStatus: null,
    rechargeExpiresAt: null,
    rechargeRemainingSeconds: 0,
  };

  let emittedCount = 0;

  if (!isScratchRewardExpired(expiresAt, sentAt.getTime())) {
    for (const userId of ids) {
      if (emitToUser(userId, MALE_SCRATCH_REWARD_EVENT, payloadBase)) {
        emittedCount += 1;
      }
    }

    import("./notificationPush.service.js")
      .then(({ notifyMaleScratchRewards }) =>
        notifyMaleScratchRewards({
          userIds: ids,
          rewardId: Number(record.id),
          rewardCoins,
          durationSeconds: duration,
          expiresAt: expiresAt.toISOString(),
          requiredPackage: payloadBase.requiredPackage,
        })
      )
      .catch((error) => {
        console.log("MALE SCRATCH NOTIFY ERROR", error.message);
      });
  }

  return {
    ...serializeScratchRewardForAdmin(record, sentAt.getTime()),
    emittedCount,
  };
};

export const listMaleScratchRewards = async () => {
  await ensureMaleScratchRewardSchema();

  const rows = await MaleScratchReward.findAll({
    order: [["createdAt", "DESC"]],
    limit: 200,
  });

  return rows.map((row) => serializeScratchRewardForAdmin(row));
};

export const getMaleScratchRewardClaims = async (rewardId) => {
  await ensureMaleScratchRewardSchema();

  const numericRewardId = Number(rewardId);

  if (!Number.isFinite(numericRewardId) || numericRewardId <= 0) {
    throw new Error("Valid reward id is required");
  }

  const reward = await MaleScratchReward.findByPk(numericRewardId);

  if (!reward) {
    throw new Error("Reward not found");
  }

  const claims = await MaleScratchRewardClaim.findAll({
    where: { rewardId: numericRewardId },
    order: [["claimedAt", "DESC"]],
  });

  const userIds = [
    ...new Set(claims.map((row) => Number(row.userId)).filter(Number.isFinite)),
  ];

  const users = userIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: userIds } },
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
    const rechargeExpiresAt = resolveClaimRechargeExpiresAt(data, reward);
    const status =
      String(data.status || "").toLowerCase() === "pending" &&
      isRechargeClaimExpired(rechargeExpiresAt)
        ? "expired"
        : data.status;

    return {
      id: Number(data.id),
      userId: Number(data.userId),
      displayName: user?.displayName || `User ${data.userId}`,
      publicUserId: user?.publicUserId || null,
      phone: user?.phone || "",
      avatar: user?.avatar || null,
      online: Boolean(user?.online),
      accountStatus: user?.accountStatus || "",
      coins: Number(data.coins) || Number(reward.rewardCoins) || 0,
      status,
      claimedAt: data.claimedAt || data.createdAt,
      paidAt: data.paidAt || null,
      rechargeExpiresAt: rechargeExpiresAt ? rechargeExpiresAt.toISOString() : null,
    };
  });

  const paidRows = rows.filter((row) => String(row.status).toLowerCase() === "paid");
  const pendingRows = rows.filter((row) => String(row.status).toLowerCase() === "pending");
  const expiredRows = rows.filter((row) => String(row.status).toLowerCase() === "expired");

  return {
    reward: serializeScratchRewardForAdmin(reward),
    summary: {
      sentCount: Number(reward.sentCount) || 0,
      claimedCount: paidRows.length,
      pendingCount: pendingRows.length,
      expiredCount: expiredRows.length,
      claimedCoins: paidRows.reduce((sum, row) => sum + Number(row.coins || 0), 0),
    },
    rows,
  };
};

export const getActiveScratchRewardForUser = async (userId) => {
  await ensureMaleScratchRewardSchema();

  const numericUserId = Number(userId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error("Valid user id is required");
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "gender"],
  });

  if (!user || !isMaleUser(user)) {
    return null;
  }

  const now = new Date();
  const rewards = await MaleScratchReward.findAll({
    order: [["createdAt", "DESC"]],
    limit: 30,
  });

  const claims = await MaleScratchRewardClaim.findAll({
    where: {
      userId: numericUserId,
      rewardId: {
        [Op.in]: rewards.map((row) => row.id),
      },
    },
  });

  const claimMap = new Map(claims.map((row) => [Number(row.rewardId), row]));

  for (const reward of rewards) {
    if (!isScratchRewardTargetedAtUser(reward, numericUserId)) {
      continue;
    }

    const claim = claimMap.get(Number(reward.id)) || null;
    const payload = await serializeScratchRewardForClient(
      reward,
      numericUserId,
      claim,
      now.getTime()
    );

    if (payload) {
      return payload;
    }
  }

  return null;
};

const creditScratchCoins = async ({ userId, coins, rewardId, transaction }) => {
  let wallet = await Wallet.findOne({
    where: { userId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!wallet) {
    wallet = await Wallet.create(
      {
        userId,
        balance: 0,
      },
      { transaction }
    );
  }

  wallet.balance = Number(wallet.balance ?? 0) + Number(coins);
  await wallet.save({ transaction });

  await WalletTransaction.create(
    {
      userId,
      type: "scratch_reward",
      amount: coins,
      description: "Male scratch card reward",
      referenceId: rewardId,
      referenceType: "male_scratch_reward",
    },
    { transaction }
  );

  return wallet;
};

export const claimMaleScratchReward = async (userId, rewardId) => {
  await ensureMaleScratchRewardSchema();

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

  if (!user || !isMaleUser(user)) {
    throw new Error("This reward is only for male users");
  }

  const transaction = await sequelize.transaction();

  try {
    const reward = await MaleScratchReward.findByPk(numericRewardId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!reward || !isScratchRewardTargetedAtUser(reward, numericUserId)) {
      throw new Error("Reward not found");
    }

    let claim = await MaleScratchRewardClaim.findOne({
      where: {
        rewardId: numericRewardId,
        userId: numericUserId,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (String(claim?.status || "").toLowerCase() === "paid") {
      throw new Error("Reward already claimed");
    }

    if (String(claim?.status || "").toLowerCase() === "expired") {
      throw new Error("Recharge time has expired");
    }

    const expired = isScratchRewardExpired(reward.expiresAt);

    if (expired && !claim) {
      throw new Error("This reward has expired");
    }

    const recharged = await hasQualifyingRecharge(numericUserId, reward);
    const coins = Number(reward.rewardCoins) || 0;
    const rechargeExpiresAt = claim
      ? resolveClaimRechargeExpiresAt(claim, reward)
      : buildRechargeExpiresAt(new Date(), reward.rechargeExpiryHours);

    if (claim && isRechargeClaimExpired(rechargeExpiresAt)) {
      await claim.update(
        {
          status: "expired",
          rechargeExpiresAt,
        },
        { transaction }
      );
      await transaction.commit();
      throw new Error("Recharge time has expired");
    }

    if (!claim) {
      if (expired) {
        throw new Error("This reward has expired");
      }

      claim = await MaleScratchRewardClaim.create(
        {
          rewardId: numericRewardId,
          userId: numericUserId,
          coins,
          status: "pending",
          claimedAt: new Date(),
          paidAt: null,
          rechargeExpiresAt,
        },
        { transaction }
      );
    } else if (!claim.rechargeExpiresAt) {
      await claim.update({ rechargeExpiresAt }, { transaction });
    }

    if (recharged && String(claim.status).toLowerCase() !== "paid") {
      const wallet = await creditScratchCoins({
        userId: numericUserId,
        coins,
        rewardId: numericRewardId,
        transaction,
      });

      await claim.update(
        {
          status: "paid",
          paidAt: new Date(),
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
        claimStatus: "paid",
        needsRecharge: false,
        requiredPackage: requiredPackageSnapshot(reward),
        message: "Reward claimed successfully",
      };
    }

    await transaction.commit();

    if (recharged) {
      return {
        success: true,
        rewardId: numericRewardId,
        rewardCoins: coins,
        claimStatus: "paid",
        needsRecharge: false,
        requiredPackage: requiredPackageSnapshot(reward),
        message: "Reward claimed successfully",
      };
    }

    return {
      success: true,
      rewardId: numericRewardId,
      rewardCoins: coins,
      claimStatus: "pending",
      needsRecharge: true,
      requiredPackage: requiredPackageSnapshot(reward),
      rechargeExpiresAt: rechargeExpiresAt ? new Date(rechargeExpiresAt).toISOString() : null,
      rechargeRemainingSeconds: remainingSeconds(rechargeExpiresAt),
      message: "Recharge the required package to receive these coins",
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    if (String(error?.message ?? "").includes("unique_male_scratch_reward_claim")) {
      throw new Error("Reward already claimed");
    }

    throw error;
  }
};

export const completeMaleScratchRewardsForPurchase = async ({
  userId,
  packageId,
  coins,
  amount,
}) => {
  await ensureMaleScratchRewardSchema();

  const numericUserId = Number(userId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    return { completed: 0 };
  }

  const pendingClaims = await MaleScratchRewardClaim.findAll({
    where: {
      userId: numericUserId,
      status: "pending",
    },
    order: [["claimedAt", "ASC"]],
  });

  if (!pendingClaims.length) {
    return { completed: 0 };
  }

  let completed = 0;

  for (const claim of pendingClaims) {
    const reward = await MaleScratchReward.findByPk(claim.rewardId);

    if (!reward) {
      continue;
    }

    const matches = purchaseMatchesRequiredPackage({
      packageId,
      coins,
      amount,
      requiredPackageId: reward.requiredPackageId,
      requiredPackageCoins: reward.requiredPackageCoins,
      requiredPackagePrice: reward.requiredPackagePrice,
    });

    if (!matches) {
      continue;
    }

    const transaction = await sequelize.transaction();

    try {
      const locked = await MaleScratchRewardClaim.findByPk(claim.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!locked || String(locked.status).toLowerCase() === "paid") {
        await transaction.rollback();
        continue;
      }

      const rechargeExpiresAt = resolveClaimRechargeExpiresAt(locked, reward);

      if (isRechargeClaimExpired(rechargeExpiresAt)) {
        await locked.update(
          {
            status: "expired",
            rechargeExpiresAt,
          },
          { transaction }
        );
        await transaction.commit();
        continue;
      }

      const lockedReward = await MaleScratchReward.findByPk(reward.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      const wallet = await creditScratchCoins({
        userId: numericUserId,
        coins: Number(locked.coins || lockedReward.rewardCoins) || 0,
        rewardId: Number(locked.rewardId),
        transaction,
      });

      await locked.update(
        {
          status: "paid",
          paidAt: new Date(),
        },
        { transaction }
      );

      await lockedReward.update(
        {
          claimedCount: Number(lockedReward.claimedCount || 0) + 1,
        },
        { transaction }
      );

      await transaction.commit();
      completed += 1;

      emitToUser(numericUserId, MALE_SCRATCH_REWARD_CLAIMED_EVENT, {
        id: Number(lockedReward.id),
        rewardCoins: Number(locked.coins || lockedReward.rewardCoins) || 0,
        walletBalance: wallet.balance,
        claimStatus: "paid",
      });
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      console.log("MALE SCRATCH UNLOCK ERROR", error.message);
    }
  }

  return { completed };
};

export const getMissedScratchRewardsForUser = async (userId, { since } = {}) => {
  await ensureMaleScratchRewardSchema();

  const numericUserId = Number(userId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error("Valid user id is required");
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "gender", "createdAt"],
  });

  if (!user || !isMaleUser(user)) {
    return {
      totalMissed: 0,
      missedRewards: [],
    };
  }

  const now = new Date();
  const pendingClaims = await MaleScratchRewardClaim.findAll({
    where: {
      userId: numericUserId,
      status: "pending",
    },
  });
  const pendingRewardIds = pendingClaims.map((row) => Number(row.rewardId));
  const pendingRewards = pendingRewardIds.length
    ? await MaleScratchReward.findAll({
        where: {
          id: {
            [Op.in]: pendingRewardIds,
          },
        },
      })
    : [];
  const pendingRewardMap = new Map(
    pendingRewards.map((row) => [Number(row.id), row])
  );

  for (const claim of pendingClaims) {
    const reward = pendingRewardMap.get(Number(claim.rewardId));
    const rechargeExpiresAt = resolveClaimRechargeExpiresAt(claim, reward, now);

    if (isRechargeClaimExpired(rechargeExpiresAt, now.getTime())) {
      await claim.update({
        status: "expired",
        rechargeExpiresAt,
      });
    }
  }

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

  const rewards = await MaleScratchReward.findAll({
    where,
    order: [["expiresAt", "DESC"]],
    limit: 200,
  });

  const targeted = rewards.filter((reward) =>
    isScratchRewardTargetedAtUser(reward, numericUserId)
  );

  const claims = targeted.length
    ? await MaleScratchRewardClaim.findAll({
        where: {
          userId: numericUserId,
          rewardId: {
            [Op.in]: targeted.map((row) => row.id),
          },
        },
      })
    : [];

  const claimMap = new Map(claims.map((row) => [Number(row.rewardId), row]));
  pendingClaims.forEach((row) => {
    claimMap.set(Number(row.rewardId), row);
  });

  const byId = new Map();

  pendingRewards
    .filter((reward) => isScratchRewardTargetedAtUser(reward, numericUserId))
    .forEach((reward) => {
      byId.set(Number(reward.id), reward);
    });

  targeted
    .filter((reward) => {
      const claim = claimMap.get(Number(reward.id));
      return !claim || String(claim.status).toLowerCase() !== "paid";
    })
    .forEach((reward) => {
      if (!byId.has(Number(reward.id))) {
        byId.set(Number(reward.id), reward);
      }
    });

  const missed = [...byId.values()];

  return {
    totalMissed: missed.length,
    missedRewards: missed.map((reward) => {
      const data = reward.toJSON();
      const claim = claimMap.get(Number(data.id));
      const claimStatus = String(claim?.status || "").toLowerCase() || null;
      const rechargeExpiresAt = claim
        ? resolveClaimRechargeExpiresAt(claim, data)
        : null;
      const rechargeExpired =
        claimStatus === "expired" ||
        (claimStatus === "pending" && isRechargeClaimExpired(rechargeExpiresAt));

      return {
        id: Number(data.id),
        rewardCoins: Number(data.rewardCoins) || 0,
        durationSeconds: Number(data.durationSeconds) || 0,
        expiresAt: data.expiresAt,
        sentAt: data.createdAt,
        requiredPackage: requiredPackageSnapshot(data),
        claimStatus: rechargeExpired ? "expired" : claim?.status || null,
        rechargeExpiresAt: rechargeExpiresAt
          ? rechargeExpiresAt.toISOString()
          : null,
        rechargeExpired,
      };
    }),
  };
};
