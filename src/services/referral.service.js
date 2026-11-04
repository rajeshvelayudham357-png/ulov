import crypto from "crypto";
import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { User, Wallet, WalletTransaction } from "../models/index.js";

/**
 * Female creator referral program.
 *
 * A creator shares her code; a male enters it at signup (or within the entry
 * window, before his first recharge). When he makes his first real payment the
 * creator earns a fixed bonus (added to her withdrawable balance) and he gets
 * bonus coins. Amounts are fixed when the code is applied, so later setting
 * changes never alter what was promised.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_PREFIX = "UL";

// Successful payment-order statuses across gateways and Google Play.
const PAID_ORDER_STATUSES = ["PAID", "SUCCESS", "CAPTURED", "credited"];

export const REFERRAL_STATUS = {
  JOINED: "joined",
  REWARDED: "rewarded",
};

const DEFAULT_SETTINGS = {
  enabled: true,
  femaleRewardAmount: 50,
  maleBonusCoins: 50,
  entryWindowDays: 7,
  minQualifyingAmount: 0,
};

let schemaReady = false;

export const ensureReferralSchema = async () => {
  if (schemaReady) {
    return;
  }

  await sequelize.query(`CREATE TABLE IF NOT EXISTS admin_referral_settings (
    id TINYINT NOT NULL PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    femaleRewardAmount DECIMAL(10,2) NOT NULL DEFAULT 50,
    maleBonusCoins INT NOT NULL DEFAULT 50,
    entryWindowDays INT NOT NULL DEFAULT 7,
    minQualifyingAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);

  await sequelize.query("INSERT IGNORE INTO admin_referral_settings (id) VALUES (1)");

  await sequelize.query(`CREATE TABLE IF NOT EXISTS referral_codes (
    userId INT NOT NULL PRIMARY KEY,
    code VARCHAR(16) NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_referral_code (code)
  )`);

  await sequelize.query(`CREATE TABLE IF NOT EXISTS referrals (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    referrerId INT NOT NULL,
    referredUserId INT NOT NULL,
    code VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'joined',
    femaleRewardAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
    maleBonusCoins INT NOT NULL DEFAULT 0,
    paymentOrderId VARCHAR(64) NULL,
    rewardedAt DATETIME NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_referred_user (referredUserId),
    KEY idx_referrals_referrer (referrerId, createdAt)
  )`);

  schemaReady = true;
};

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const roundMoney = (value) => Math.round(toNumber(value) * 100) / 100;

const badRequest = (message, status = 400) => {
  const error = new Error(message);
  error.statusCode = status;
  return error;
};

export const getReferralSettings = async () => {
  await ensureReferralSchema();

  const [row] = await sequelize.query(
    "SELECT * FROM admin_referral_settings WHERE id = 1 LIMIT 1",
    { type: QueryTypes.SELECT }
  );

  return {
    enabled: row ? Boolean(Number(row.enabled)) : DEFAULT_SETTINGS.enabled,
    femaleRewardAmount: roundMoney(row?.femaleRewardAmount ?? DEFAULT_SETTINGS.femaleRewardAmount),
    maleBonusCoins: toNumber(row?.maleBonusCoins, DEFAULT_SETTINGS.maleBonusCoins),
    entryWindowDays: toNumber(row?.entryWindowDays, DEFAULT_SETTINGS.entryWindowDays),
    minQualifyingAmount: roundMoney(row?.minQualifyingAmount ?? DEFAULT_SETTINGS.minQualifyingAmount),
    updatedAt: row?.updatedAt ?? null,
  };
};

export const updateReferralSettings = async (payload = {}) => {
  const current = await getReferralSettings();
  const pick = (key) => (payload[key] !== undefined ? payload[key] : current[key]);

  const femaleRewardAmount = roundMoney(pick("femaleRewardAmount"));
  const maleBonusCoins = Math.floor(toNumber(pick("maleBonusCoins"), -1));
  const entryWindowDays = Math.floor(toNumber(pick("entryWindowDays"), -1));
  const minQualifyingAmount = roundMoney(pick("minQualifyingAmount"));

  if (femaleRewardAmount < 0 || femaleRewardAmount > 10000) {
    throw badRequest("Creator reward must be between ₹0 and ₹10,000");
  }

  if (maleBonusCoins < 0 || maleBonusCoins > 100000) {
    throw badRequest("Male bonus coins must be between 0 and 100,000");
  }

  if (entryWindowDays < 0 || entryWindowDays > 365) {
    throw badRequest("Entry window must be between 0 and 365 days");
  }

  if (minQualifyingAmount < 0) {
    throw badRequest("Minimum qualifying payment cannot be negative");
  }

  await sequelize.query(
    `UPDATE admin_referral_settings
     SET enabled = :enabled,
         femaleRewardAmount = :femaleRewardAmount,
         maleBonusCoins = :maleBonusCoins,
         entryWindowDays = :entryWindowDays,
         minQualifyingAmount = :minQualifyingAmount
     WHERE id = 1`,
    {
      replacements: {
        enabled: Boolean(pick("enabled")) ? 1 : 0,
        femaleRewardAmount,
        maleBonusCoins,
        entryWindowDays,
        minQualifyingAmount,
      },
    }
  );

  return getReferralSettings();
};

export const normalizeReferralCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const generateCode = () => {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = CODE_PREFIX;

  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }

  return code;
};

/** A creator's code, created on first use. */
export const getOrCreateReferralCode = async (userId) => {
  await ensureReferralSchema();

  const [existing] = await sequelize.query(
    "SELECT code FROM referral_codes WHERE userId = :userId LIMIT 1",
    { replacements: { userId: Number(userId) }, type: QueryTypes.SELECT }
  );

  if (existing) {
    return existing.code;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCode();

    try {
      await sequelize.query(
        "INSERT INTO referral_codes (userId, code) VALUES (:userId, :code)",
        { replacements: { userId: Number(userId), code } }
      );
      return code;
    } catch (error) {
      if (error?.name !== "SequelizeUniqueConstraintError") {
        throw error;
      }

      // Either the code collided or a concurrent request created this user's code.
      const [row] = await sequelize.query(
        "SELECT code FROM referral_codes WHERE userId = :userId LIMIT 1",
        { replacements: { userId: Number(userId) }, type: QueryTypes.SELECT }
      );

      if (row) {
        return row.code;
      }
    }
  }

  throw new Error("Could not generate a referral code");
};

const isFemale = (user) => String(user?.gender ?? "").toLowerCase() === "female";
const isMale = (user) => String(user?.gender ?? "").toLowerCase() === "male";

const displayName = (row) =>
  row.nickname ||
  (row.name && row.name !== "New User" ? row.name : null) ||
  `User ${row.id}`;

const hasPaidOrder = async (userId) => {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS paid FROM payment_orders
     WHERE userId = :userId AND status IN (:statuses)`,
    {
      replacements: { userId: Number(userId), statuses: PAID_ORDER_STATUSES },
      type: QueryTypes.SELECT,
    }
  );
  return toNumber(row?.paid) > 0;
};

/** Total referral bonuses a creator has earned (part of her withdrawable balance). */
export const getReferralEarningsTotal = async (userId) => {
  await ensureReferralSchema();

  const [row] = await sequelize.query(
    `SELECT COALESCE(SUM(femaleRewardAmount), 0) AS total
     FROM referrals
     WHERE referrerId = :userId AND status = :status`,
    {
      replacements: { userId: Number(userId), status: REFERRAL_STATUS.REWARDED },
      type: QueryTypes.SELECT,
    }
  );

  return roundMoney(row?.total);
};

export const getFemaleReferralOverview = async ({ userId, page = 1, limit = 20 }) => {
  const user = await User.findByPk(userId, { attributes: ["id", "gender"] });

  if (!isFemale(user)) {
    throw badRequest("The referral program is for creators", 403);
  }

  const settings = await getReferralSettings();
  const code = await getOrCreateReferralCode(userId);
  const safeLimit = Math.min(50, Math.max(1, Math.floor(toNumber(limit, 20))));
  const safePage = Math.max(1, Math.floor(toNumber(page, 1)));

  const [stats] = await sequelize.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status = 'rewarded'), 0) AS rewarded,
            COALESCE(SUM(status = 'joined'), 0) AS pending,
            COALESCE(SUM(CASE WHEN status = 'rewarded' THEN femaleRewardAmount ELSE 0 END), 0) AS earned
     FROM referrals WHERE referrerId = :userId`,
    { replacements: { userId: Number(userId) }, type: QueryTypes.SELECT }
  );

  const rows = await sequelize.query(
    `SELECT r.id, r.status, r.femaleRewardAmount, r.createdAt, r.rewardedAt,
            u.id AS userId, u.nickname, u.name, u.avatar
     FROM referrals r
     LEFT JOIN users u ON u.id = r.referredUserId
     WHERE r.referrerId = :userId
     ORDER BY r.createdAt DESC, r.id DESC
     LIMIT :limit OFFSET :offset`,
    {
      replacements: {
        userId: Number(userId),
        limit: safeLimit,
        offset: (safePage - 1) * safeLimit,
      },
      type: QueryTypes.SELECT,
    }
  );

  const total = toNumber(stats?.total);

  return {
    enabled: settings.enabled,
    code,
    rewards: {
      creatorRewardAmount: settings.femaleRewardAmount,
      maleBonusCoins: settings.maleBonusCoins,
      entryWindowDays: settings.entryWindowDays,
    },
    stats: {
      total,
      rewarded: toNumber(stats?.rewarded),
      pending: toNumber(stats?.pending),
      earned: roundMoney(stats?.earned),
    },
    referrals: rows.map((row) => ({
      id: row.id,
      user: {
        id: row.userId,
        name: displayName({ id: row.userId, nickname: row.nickname, name: row.name }),
        avatar: row.avatar ?? null,
      },
      status: row.status,
      rewardAmount: row.status === REFERRAL_STATUS.REWARDED ? roundMoney(row.femaleRewardAmount) : 0,
      joinedAt: row.createdAt,
      rewardedAt: row.rewardedAt,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasMore: safePage * safeLimit < total,
    },
  };
};

/** Whether a male can still enter a code, and the one he entered. */
export const getMaleReferralStatus = async (userId) => {
  await ensureReferralSchema();
  const user = await User.findByPk(userId, { attributes: ["id", "gender", "createdAt"] });

  if (!isMale(user)) {
    return { eligible: false, reason: "not_male", applied: null };
  }

  const settings = await getReferralSettings();
  const [applied] = await sequelize.query(
    `SELECT r.code, r.status, r.maleBonusCoins, r.createdAt, u.nickname, u.name, u.id AS referrerId
     FROM referrals r LEFT JOIN users u ON u.id = r.referrerId
     WHERE r.referredUserId = :userId LIMIT 1`,
    { replacements: { userId: Number(userId) }, type: QueryTypes.SELECT }
  );

  const windowEndsAt = new Date(
    new Date(user.createdAt).getTime() + settings.entryWindowDays * 24 * 60 * 60 * 1000
  );

  let reason = null;

  if (applied) {
    reason = "already_applied";
  } else if (!settings.enabled) {
    reason = "disabled";
  } else if (Date.now() > windowEndsAt.getTime()) {
    reason = "window_closed";
  } else if (await hasPaidOrder(userId)) {
    reason = "already_recharged";
  }

  return {
    eligible: !reason,
    reason,
    windowEndsAt,
    maleBonusCoins: settings.maleBonusCoins,
    applied: applied
      ? {
          code: applied.code,
          status: applied.status,
          bonusCoins: toNumber(applied.maleBonusCoins),
          referrerName: displayName({
            id: applied.referrerId,
            nickname: applied.nickname,
            name: applied.name,
          }),
          appliedAt: applied.createdAt,
        }
      : null,
  };
};

const STATUS_MESSAGES = {
  not_male: "Referral codes can be entered by male users only",
  already_applied: "You have already used a referral code",
  disabled: "The referral program is not available right now",
  window_closed: "Referral codes can only be entered within the first days after joining",
  already_recharged: "Referral codes can only be used before your first recharge",
};

export const applyReferralCode = async ({ userId, code }) => {
  const normalized = normalizeReferralCode(code);

  if (!normalized) {
    throw badRequest("Enter a referral code");
  }

  const status = await getMaleReferralStatus(userId);

  if (!status.eligible) {
    throw badRequest(STATUS_MESSAGES[status.reason] || "You cannot use a referral code", 409);
  }

  const [owner] = await sequelize.query(
    `SELECT rc.userId, u.gender, u.blocked, u.accountStatus, u.nickname, u.name
     FROM referral_codes rc JOIN users u ON u.id = rc.userId
     WHERE rc.code = :code LIMIT 1`,
    { replacements: { code: normalized }, type: QueryTypes.SELECT }
  );

  if (!owner || !isFemale(owner)) {
    throw badRequest("This referral code is not valid", 404);
  }

  const accountStatus = String(owner.accountStatus ?? "approved").toLowerCase();

  if (Number(owner.blocked) === 1 || (accountStatus && accountStatus !== "approved")) {
    throw badRequest("This referral code is not active");
  }

  const settings = await getReferralSettings();

  try {
    await sequelize.query(
      `INSERT INTO referrals (referrerId, referredUserId, code, status, femaleRewardAmount, maleBonusCoins)
       VALUES (:referrerId, :referredUserId, :code, :status, :femaleRewardAmount, :maleBonusCoins)`,
      {
        replacements: {
          referrerId: Number(owner.userId),
          referredUserId: Number(userId),
          code: normalized,
          status: REFERRAL_STATUS.JOINED,
          femaleRewardAmount: settings.femaleRewardAmount,
          maleBonusCoins: settings.maleBonusCoins,
        },
      }
    );
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError") {
      throw badRequest(STATUS_MESSAGES.already_applied, 409);
    }
    throw error;
  }

  return {
    message: `Code applied! You'll get ${settings.maleBonusCoins} bonus coins on your first recharge.`,
    referrerName: displayName({ id: owner.userId, nickname: owner.nickname, name: owner.name }),
    bonusCoins: settings.maleBonusCoins,
  };
};

/**
 * Called after a real payment is credited. Rewards a pending referral once:
 * the row lock and the status change make repeated calls a no-op.
 */
export const processReferralQualifyingPayment = async ({ userId, paymentOrderId, amount }) => {
  await ensureReferralSchema();
  const settings = await getReferralSettings();

  if (toNumber(amount) < settings.minQualifyingAmount) {
    return null;
  }

  return sequelize.transaction(async (transaction) => {
    const [referral] = await sequelize.query(
      `SELECT * FROM referrals
       WHERE referredUserId = :userId AND status = :status
       LIMIT 1 FOR UPDATE`,
      {
        replacements: { userId: Number(userId), status: REFERRAL_STATUS.JOINED },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    if (!referral) {
      return null;
    }

    const bonusCoins = Math.max(0, Math.floor(toNumber(referral.maleBonusCoins)));

    if (bonusCoins > 0) {
      const [wallet] = await Wallet.findOrCreate({
        where: { userId: Number(userId) },
        defaults: { userId: Number(userId), balance: 0 },
        transaction,
      });

      await wallet.increment("balance", { by: bonusCoins, transaction });

      await WalletTransaction.create(
        {
          userId: Number(userId),
          type: "credit",
          amount: bonusCoins,
          description: "Referral bonus",
          referenceId: referral.id,
          referenceType: "referral",
        },
        { transaction }
      );
    }

    await sequelize.query(
      `UPDATE referrals
       SET status = :rewarded, paymentOrderId = :paymentOrderId, rewardedAt = NOW()
       WHERE id = :id AND status = :joined`,
      {
        replacements: {
          id: referral.id,
          rewarded: REFERRAL_STATUS.REWARDED,
          joined: REFERRAL_STATUS.JOINED,
          paymentOrderId: paymentOrderId ? String(paymentOrderId) : null,
        },
        transaction,
      }
    );

    return {
      referralId: referral.id,
      referrerId: Number(referral.referrerId),
      creatorReward: roundMoney(referral.femaleRewardAmount),
      bonusCoins,
    };
  });
};

/** Fire-and-forget wrapper for payment flows: a referral problem must never fail a payment. */
export const rewardReferralAfterPayment = async (params) => {
  try {
    return await processReferralQualifyingPayment(params);
  } catch (error) {
    console.log("REFERRAL REWARD ERROR", params?.userId, error.message);
    return null;
  }
};

export const listReferralsForAdmin = async ({ page = 1, limit = 25, status = null, search = "" } = {}) => {
  await ensureReferralSchema();
  const safeLimit = Math.min(100, Math.max(1, Math.floor(toNumber(limit, 25))));
  const safePage = Math.max(1, Math.floor(toNumber(page, 1)));
  const where = [];
  const replacements = { limit: safeLimit, offset: (safePage - 1) * safeLimit };

  if (status === REFERRAL_STATUS.JOINED || status === REFERRAL_STATUS.REWARDED) {
    where.push("r.status = :status");
    replacements.status = status;
  }

  const term = String(search || "").trim();

  if (term) {
    where.push(
      "(r.code LIKE :term OR f.nickname LIKE :term OR f.name LIKE :term OR m.nickname LIKE :term OR m.name LIKE :term OR CAST(r.referrerId AS CHAR) = :exact OR CAST(r.referredUserId AS CHAR) = :exact)"
    );
    replacements.term = `%${term}%`;
    replacements.exact = term;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const fromSql = `FROM referrals r
    LEFT JOIN users f ON f.id = r.referrerId
    LEFT JOIN users m ON m.id = r.referredUserId
    ${whereSql}`;

  const [summary] = await sequelize.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(r.status = 'rewarded'), 0) AS rewarded,
            COALESCE(SUM(r.status = 'joined'), 0) AS pending,
            COALESCE(SUM(CASE WHEN r.status = 'rewarded' THEN r.femaleRewardAmount ELSE 0 END), 0) AS creatorRewards,
            COALESCE(SUM(CASE WHEN r.status = 'rewarded' THEN r.maleBonusCoins ELSE 0 END), 0) AS bonusCoins
     ${fromSql}`,
    { replacements, type: QueryTypes.SELECT }
  );

  const rows = await sequelize.query(
    `SELECT r.*, f.nickname AS referrerNickname, f.name AS referrerName,
            m.nickname AS referredNickname, m.name AS referredName
     ${fromSql}
     ORDER BY r.createdAt DESC, r.id DESC
     LIMIT :limit OFFSET :offset`,
    { replacements, type: QueryTypes.SELECT }
  );

  return {
    summary: {
      total: toNumber(summary?.total),
      rewarded: toNumber(summary?.rewarded),
      pending: toNumber(summary?.pending),
      creatorRewards: roundMoney(summary?.creatorRewards),
      bonusCoins: toNumber(summary?.bonusCoins),
    },
    referrals: rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      referrer: {
        id: row.referrerId,
        name: displayName({ id: row.referrerId, nickname: row.referrerNickname, name: row.referrerName }),
      },
      referred: {
        id: row.referredUserId,
        name: displayName({ id: row.referredUserId, nickname: row.referredNickname, name: row.referredName }),
      },
      creatorReward: roundMoney(row.femaleRewardAmount),
      bonusCoins: toNumber(row.maleBonusCoins),
      paymentOrderId: row.paymentOrderId,
      joinedAt: row.createdAt,
      rewardedAt: row.rewardedAt,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: toNumber(summary?.total),
    },
  };
};
