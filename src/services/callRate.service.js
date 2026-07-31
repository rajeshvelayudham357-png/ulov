import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";
import { normalizeCallTypeForDb } from "../constants/callTypes.js";

const DEFAULT_SETTINGS = {
  voiceRatePerMinute: 60,
  videoRatePerMinute: 60,
  femaleEarningPercentage: 50,
};

// Base coin value reference (e.g., ₹69 / 160 coins = 0.43125 INR / coin)
const DEFAULT_COIN_VALUE = 69 / 160;

let tableReady = false;
let creatorTableReady = false;

const ensureCallRateTable = async () => {
  if (tableReady) return;

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_call_rate_settings (
      id TINYINT NOT NULL PRIMARY KEY,
      voiceRatePerMinute FLOAT NOT NULL DEFAULT 60,
      videoRatePerMinute FLOAT NOT NULL DEFAULT 60,
      femaleEarningPercentage FLOAT NOT NULL DEFAULT 50,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_call_rate_settings
    (id, voiceRatePerMinute, videoRatePerMinute, femaleEarningPercentage)
    VALUES (1, :voiceRatePerMinute, :videoRatePerMinute, :femaleEarningPercentage)`,
    { replacements: DEFAULT_SETTINGS }
  );

  try {
    await sequelize.query(
      `ALTER TABLE users ADD COLUMN effectiveCoinValue FLOAT NULL DEFAULT 0.43125`
    );
  } catch (_e) {}

  tableReady = true;
};

const ensureCreatorCallRateTable = async () => {
  if (creatorTableReady) return;

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS creator_call_rate_settings (
      userId BIGINT NOT NULL PRIMARY KEY,
      femaleEarningPercentage FLOAT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  creatorTableReady = true;
};

const toPositiveNumber = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : fallback;

const clampPercentage = (value, fallback) =>
  Math.min(
    100,
    Math.max(0, toPositiveNumber(value, fallback))
  );

export const getCallRateSettings = async () => {
  await ensureCallRateTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_call_rate_settings WHERE id = 1 LIMIT 1",
    { type: QueryTypes.SELECT }
  );

  const row = rows[0] || DEFAULT_SETTINGS;

  return {
    voiceRatePerMinute:
      Number(row.voiceRatePerMinute) || DEFAULT_SETTINGS.voiceRatePerMinute,
    videoRatePerMinute:
      Number(row.videoRatePerMinute) || DEFAULT_SETTINGS.videoRatePerMinute,
    femaleEarningPercentage:
      Number(row.femaleEarningPercentage) || DEFAULT_SETTINGS.femaleEarningPercentage,
    updatedAt: row.updatedAt || null,
  };
};

export const getCreatorEarningPercentage = async (creatorId, fallbackPercentage) => {
  await ensureCreatorCallRateTable();

  if (!creatorId) return fallbackPercentage;

  const rows = await sequelize.query(
    "SELECT femaleEarningPercentage FROM creator_call_rate_settings WHERE userId = :creatorId LIMIT 1",
    {
      replacements: { creatorId },
      type: QueryTypes.SELECT,
    }
  );

  if (!rows[0]) return fallbackPercentage;

  return clampPercentage(rows[0].femaleEarningPercentage, fallbackPercentage);
};

export const getCreatorCallRateSettings = async () => {
  await ensureCreatorCallRateTable();

  const globalSettings = await getCallRateSettings();

  const rows = await sequelize.query(
    `SELECT
      users.id,
      users.publicUserId,
      users.name,
      users.nickname,
      users.username,
      users.phone,
      users.avatar,
      users.online,
      creator_call_rate_settings.femaleEarningPercentage AS customFemaleEarningPercentage,
      creator_call_rate_settings.updatedAt AS customUpdatedAt
    FROM users
    LEFT JOIN creator_call_rate_settings
      ON creator_call_rate_settings.userId = users.id
    WHERE users.gender = 'Female'
    ORDER BY users.createdAt DESC`,
    { type: QueryTypes.SELECT }
  );

  return rows.map((row) => {
    const customPercentage =
      row.customFemaleEarningPercentage === null ||
      row.customFemaleEarningPercentage === undefined
        ? null
        : Number(row.customFemaleEarningPercentage);

    const effectivePercentage =
      customPercentage === null
        ? globalSettings.femaleEarningPercentage
        : clampPercentage(customPercentage, globalSettings.femaleEarningPercentage);

    return {
      id: row.id,
      publicUserId: row.publicUserId,
      name:
        row.nickname ||
        (row.name && row.name !== "New User" ? row.name : null) ||
        row.username ||
        row.phone ||
        "Unknown",
      phone: row.phone,
      avatar: row.avatar,
      online: Boolean(row.online),
      voiceRatePerMinute: globalSettings.voiceRatePerMinute,
      videoRatePerMinute: globalSettings.videoRatePerMinute,
      globalFemaleEarningPercentage: globalSettings.femaleEarningPercentage,
      customFemaleEarningPercentage: customPercentage,
      effectiveFemaleEarningPercentage: effectivePercentage,
      usesCustomPercentage: customPercentage !== null,
      updatedAt: row.customUpdatedAt || null,
    };
  });
};

export const updateCreatorEarningPercentage = async (creatorId, percentage) => {
  await ensureCreatorCallRateTable();

  const value = clampPercentage(percentage, 0);

  await sequelize.query(
    `INSERT INTO creator_call_rate_settings (userId, femaleEarningPercentage)
     VALUES (:creatorId, :percentage)
     ON DUPLICATE KEY UPDATE femaleEarningPercentage = VALUES(femaleEarningPercentage), updatedAt = NOW()`,
    {
      replacements: { creatorId, percentage: value },
    }
  );

  return {
    userId: creatorId,
    femaleEarningPercentage: value,
  };
};

export const updateCallRateSettings = async (settings) => {
  await ensureCallRateTable();

  const current = await getCallRateSettings();

  const next = {
    voiceRatePerMinute: toPositiveNumber(
      settings.voiceRatePerMinute,
      current.voiceRatePerMinute
    ),
    videoRatePerMinute: toPositiveNumber(
      settings.videoRatePerMinute,
      current.videoRatePerMinute
    ),
    femaleEarningPercentage: clampPercentage(
      settings.femaleEarningPercentage,
      current.femaleEarningPercentage
    ),
  };

  await sequelize.query(
    `UPDATE admin_call_rate_settings
     SET voiceRatePerMinute = :voiceRatePerMinute,
         videoRatePerMinute = :videoRatePerMinute,
         femaleEarningPercentage = :femaleEarningPercentage,
         updatedAt = NOW()
     WHERE id = 1`,
    { replacements: next }
  );

  return getCallRateSettings();
};

export const calculateCallBilling = async ({ duration, type, callerId, receiverId }) => {
  const settings = await getCallRateSettings();
  const durationSeconds = Math.max(0, Number(duration) || 0);
  const normalizedType = normalizeCallTypeForDb(type);
  const ratePerMinute =
    normalizedType === "voice"
      ? settings.voiceRatePerMinute
      : settings.videoRatePerMinute;

  const VIDEO_FIRST_HALF_SECONDS = 30;
  let minutes = 0;
  let maleCost = 0;

  if (durationSeconds <= 0) {
    minutes = 0;
    maleCost = 0;
  } else if (
    normalizedType === "video" &&
    durationSeconds <= VIDEO_FIRST_HALF_SECONDS
  ) {
    minutes = 0.5;
    maleCost = Math.max(1, Math.ceil(ratePerMinute / 2));
  } else {
    minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    maleCost = Math.ceil(minutes * ratePerMinute);
  }

  // Determine caller's effective coin value (Recharge Amount / Coins Credited)
  let coinValue = DEFAULT_COIN_VALUE;
  if (callerId) {
    try {
      const userRows = await sequelize.query(
        "SELECT effectiveCoinValue FROM users WHERE id = :callerId LIMIT 1",
        { replacements: { callerId }, type: QueryTypes.SELECT }
      );
      if (userRows[0] && Number(userRows[0].effectiveCoinValue) > 0) {
        coinValue = Number(userRows[0].effectiveCoinValue);
      }
    } catch (_e) {}
  }

  // 1. Gross Revenue = Coins Spent * Effective Coin Value
  const revenue = Number((maleCost * coinValue).toFixed(2));

  const creatorPercentage = await getCreatorEarningPercentage(
    receiverId,
    settings.femaleEarningPercentage
  );

  // 2. Creator INR Earnings = Gross Revenue * Creator Percentage
  const femaleAmount = Number((revenue * (creatorPercentage / 100)).toFixed(2));

  // 3. Platform INR Earnings = Gross Revenue - Creator Earnings
  const platformAmount = Number((revenue - femaleAmount).toFixed(2));

  // 4. Female Coins Earned (for coin logging/audit)
  const femaleEarn = Math.floor(maleCost * (creatorPercentage / 100));

  return {
    settings,
    minutes,
    type: normalizedType,
    ratePerMinute,
    femaleEarningPercentage: creatorPercentage,
    maleCost,
    coinValue,
    revenue,
    femaleEarn,
    femaleAmount,
    platformAmount,
  };
};

export const getPublicCallRates = async () => {
  const settings = await getCallRateSettings();

  return {
    voiceRatePerMinute: settings.voiceRatePerMinute,
    videoRatePerMinute: settings.videoRatePerMinute,
    femaleEarningPercentage: settings.femaleEarningPercentage,
    updatedAt: settings.updatedAt,
  };
};

export const getCreatorCallRateSummary = async (creatorId) => {
  await ensureCreatorCallRateTable();

  const settings = await getCallRateSettings();

  const femaleEarningPercentage = await getCreatorEarningPercentage(
    creatorId,
    settings.femaleEarningPercentage
  );

  const customRows = creatorId
    ? await sequelize.query(
        "SELECT femaleEarningPercentage FROM creator_call_rate_settings WHERE userId = :creatorId LIMIT 1",
        { replacements: { creatorId }, type: QueryTypes.SELECT }
      )
    : [];

  const usesCustomPercentage = customRows.length > 0;

  // Base coin value reference (e.g. ₹69 / 160 coins = 0.43125)
  const baseCoinValue = DEFAULT_COIN_VALUE;

  const voiceCoinsPerMinute = settings.voiceRatePerMinute;
  const voiceRevenuePerMinute = Number((voiceCoinsPerMinute * baseCoinValue).toFixed(2));
  const voiceCreatorEarnPerMinute = Number((voiceRevenuePerMinute * (femaleEarningPercentage / 100)).toFixed(2));
  const voicePlatformEarnPerMinute = Number((voiceRevenuePerMinute - voiceCreatorEarnPerMinute).toFixed(2));

  const videoCoinsPerMinute = settings.videoRatePerMinute;
  const videoRevenuePerMinute = Number((videoCoinsPerMinute * baseCoinValue).toFixed(2));
  const videoCreatorEarnPerMinute = Number((videoRevenuePerMinute * (femaleEarningPercentage / 100)).toFixed(2));
  const videoPlatformEarnPerMinute = Number((videoRevenuePerMinute - videoCreatorEarnPerMinute).toFixed(2));

  return {
    voiceRatePerMinute: settings.voiceRatePerMinute,
    videoRatePerMinute: settings.videoRatePerMinute,
    globalFemaleEarningPercentage: settings.femaleEarningPercentage,
    femaleEarningPercentage,
    usesCustomPercentage,
    // Detailed Revenue & INR breakdown
    voiceCoinsPerMinute,
    voiceRevenuePerMinute,
    voiceCreatorEarnPerMinute,
    voicePlatformEarnPerMinute,
    videoCoinsPerMinute,
    videoRevenuePerMinute,
    videoCreatorEarnPerMinute,
    videoPlatformEarnPerMinute,
    // Creator INR per minute earnings
    voiceEarnPerMinute: voiceCreatorEarnPerMinute,
    videoEarnPerMinute: videoCreatorEarnPerMinute,
    updatedAt: settings.updatedAt,
  };
};
