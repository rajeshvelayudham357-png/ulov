import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";
import { normalizeCallTypeForDb } from "../constants/callTypes.js";
import {
  clampPercentage,
  computeCreatorEarnings,
  computeMaleCallCost,
  DEFAULT_CALL_RATE_SETTINGS,
  parseOptionalRate,
  resolveEffectiveRate,
  toPositiveNumber,
} from "../utils/callRate.util.js";

const DEFAULT_SETTINGS = DEFAULT_CALL_RATE_SETTINGS;

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
      voiceRatePerMinute FLOAT NULL,
      videoRatePerMinute FLOAT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  for (const [column, definition] of [
    ["voiceRatePerMinute", "FLOAT NULL"],
    ["videoRatePerMinute", "FLOAT NULL"],
  ]) {
    try {
      await sequelize.query(
        `ALTER TABLE creator_call_rate_settings ADD COLUMN \`${column}\` ${definition}`
      );
    } catch (_error) {
      // Column already exists.
    }
  }

  creatorTableReady = true;
};

export const getCreatorCustomRateRow = async (creatorId) => {
  await ensureCreatorCallRateTable();

  if (!creatorId) {
    return null;
  }

  const rows = await sequelize.query(
    `SELECT femaleEarningPercentage, voiceRatePerMinute, videoRatePerMinute
     FROM creator_call_rate_settings
     WHERE userId = :creatorId
     LIMIT 1`,
    {
      replacements: { creatorId },
      type: QueryTypes.SELECT,
    }
  );

  return rows[0] || null;
};

export const getCreatorCallRatesMap = async (creatorIds = []) => {
  await ensureCreatorCallRateTable();

  const ids = [...new Set(creatorIds.map((id) => Number(id)).filter(Boolean))];

  if (!ids.length) {
    return new Map();
  }

  const globalSettings = await getCallRateSettings();

  const rows = await sequelize.query(
    `SELECT userId, voiceRatePerMinute, videoRatePerMinute
     FROM creator_call_rate_settings
     WHERE userId IN (${ids.map(() => "?").join(",")})`,
    {
      replacements: ids,
      type: QueryTypes.SELECT,
    }
  );

  const rowByUserId = new Map(
    rows.map((row) => [Number(row.userId), row])
  );

  const map = new Map();

  for (const id of ids) {
    const row = rowByUserId.get(id);

    map.set(id, {
      voiceRatePerMinute: resolveEffectiveRate(
        row?.voiceRatePerMinute,
        globalSettings.voiceRatePerMinute,
        DEFAULT_SETTINGS.voiceRatePerMinute
      ),
      videoRatePerMinute: resolveEffectiveRate(
        row?.videoRatePerMinute,
        globalSettings.videoRatePerMinute,
        DEFAULT_SETTINGS.videoRatePerMinute
      ),
      usesCustomVoiceRate: parseOptionalRate(row?.voiceRatePerMinute) !== null,
      usesCustomVideoRate: parseOptionalRate(row?.videoRatePerMinute) !== null,
    });
  }

  return map;
};

export const attachCreatorCallRates = async (users = []) => {
  const globalSettings = await getCallRateSettings();
  const femaleIds = users
    .map((user) => {
      const data = typeof user?.toJSON === "function" ? user.toJSON() : user;
      return String(data?.gender ?? "").toLowerCase() === "female"
        ? Number(data.id)
        : null;
    })
    .filter(Boolean);

  const ratesMap = await getCreatorCallRatesMap(femaleIds);

  return users.map((user) => {
    const data = typeof user?.toJSON === "function" ? user.toJSON() : { ...user };
    const isFemale = String(data?.gender ?? "").toLowerCase() === "female";

    if (!isFemale) {
      return data;
    }

    const creatorId = Number(data.id);
    const creatorRates = ratesMap.get(creatorId);

    return {
      ...data,
      voiceRatePerMinute:
        creatorRates?.voiceRatePerMinute ?? globalSettings.voiceRatePerMinute,
      videoRatePerMinute:
        creatorRates?.videoRatePerMinute ?? globalSettings.videoRatePerMinute,
    };
  });
};

export const getEffectiveCreatorCallRates = async (creatorId, globalSettings = null) => {
  const settings = globalSettings || (await getCallRateSettings());
  const customRow = await getCreatorCustomRateRow(creatorId);

  const customVoice = parseOptionalRate(customRow?.voiceRatePerMinute);
  const customVideo = parseOptionalRate(customRow?.videoRatePerMinute);

  return {
    voiceRatePerMinute: resolveEffectiveRate(
      customVoice,
      settings.voiceRatePerMinute,
      DEFAULT_SETTINGS.voiceRatePerMinute
    ),
    videoRatePerMinute: resolveEffectiveRate(
      customVideo,
      settings.videoRatePerMinute,
      DEFAULT_SETTINGS.videoRatePerMinute
    ),
    usesCustomVoiceRate: customVoice !== null,
    usesCustomVideoRate: customVideo !== null,
    customVoiceRatePerMinute: customVoice,
    customVideoRatePerMinute: customVideo,
  };
};

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
      creator_call_rate_settings.voiceRatePerMinute AS customVoiceRatePerMinute,
      creator_call_rate_settings.videoRatePerMinute AS customVideoRatePerMinute,
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

    const customVoiceRate = parseOptionalRate(row.customVoiceRatePerMinute);
    const customVideoRate = parseOptionalRate(row.customVideoRatePerMinute);

    const effectiveVoiceRate = resolveEffectiveRate(
      customVoiceRate,
      globalSettings.voiceRatePerMinute,
      DEFAULT_SETTINGS.voiceRatePerMinute
    );
    const effectiveVideoRate = resolveEffectiveRate(
      customVideoRate,
      globalSettings.videoRatePerMinute,
      DEFAULT_SETTINGS.videoRatePerMinute
    );

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
      globalVoiceRatePerMinute: globalSettings.voiceRatePerMinute,
      globalVideoRatePerMinute: globalSettings.videoRatePerMinute,
      voiceRatePerMinute: effectiveVoiceRate,
      videoRatePerMinute: effectiveVideoRate,
      customVoiceRatePerMinute: customVoiceRate,
      customVideoRatePerMinute: customVideoRate,
      usesCustomVoiceRate: customVoiceRate !== null,
      usesCustomVideoRate: customVideoRate !== null,
      globalFemaleEarningPercentage: globalSettings.femaleEarningPercentage,
      customFemaleEarningPercentage: customPercentage,
      effectiveFemaleEarningPercentage: effectivePercentage,
      usesCustomPercentage: customPercentage !== null,
      updatedAt: row.customUpdatedAt || null,
    };
  });
};

export const updateCreatorCallRateSettings = async (
  creatorId,
  {
    femaleEarningPercentage,
    voiceRatePerMinute,
    videoRatePerMinute,
  } = {}
) => {
  await ensureCreatorCallRateTable();

  const globalSettings = await getCallRateSettings();
  const existing = (await getCreatorCustomRateRow(creatorId)) || {};

  const nextPercentage =
    femaleEarningPercentage !== undefined
      ? clampPercentage(
          femaleEarningPercentage,
          globalSettings.femaleEarningPercentage
        )
      : clampPercentage(
          existing.femaleEarningPercentage,
          globalSettings.femaleEarningPercentage
        );

  const nextVoiceRate =
    voiceRatePerMinute !== undefined
      ? parseOptionalRate(voiceRatePerMinute)
      : parseOptionalRate(existing.voiceRatePerMinute);

  const nextVideoRate =
    videoRatePerMinute !== undefined
      ? parseOptionalRate(videoRatePerMinute)
      : parseOptionalRate(existing.videoRatePerMinute);

  await sequelize.query(
    `INSERT INTO creator_call_rate_settings
      (userId, femaleEarningPercentage, voiceRatePerMinute, videoRatePerMinute)
     VALUES (:creatorId, :percentage, :voiceRate, :videoRate)
     ON DUPLICATE KEY UPDATE
       femaleEarningPercentage = VALUES(femaleEarningPercentage),
       voiceRatePerMinute = VALUES(voiceRatePerMinute),
       videoRatePerMinute = VALUES(videoRatePerMinute),
       updatedAt = NOW()`,
    {
      replacements: {
        creatorId,
        percentage: nextPercentage,
        voiceRate: nextVoiceRate,
        videoRate: nextVideoRate,
      },
    }
  );

  return {
    userId: creatorId,
    femaleEarningPercentage: nextPercentage,
    voiceRatePerMinute: nextVoiceRate,
    videoRatePerMinute: nextVideoRate,
  };
};

export const updateCreatorEarningPercentage = async (creatorId, percentage) =>
  updateCreatorCallRateSettings(creatorId, {
    femaleEarningPercentage: percentage,
  });

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
  const creatorRates = await getEffectiveCreatorCallRates(receiverId, settings);
  const normalizedType = normalizeCallTypeForDb(type);
  const ratePerMinute =
    normalizedType === "voice"
      ? creatorRates.voiceRatePerMinute
      : creatorRates.videoRatePerMinute;

  const { minutes, maleCost } = computeMaleCallCost({
    durationSeconds: duration,
    type: normalizedType,
    ratePerMinute,
  });

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
  const creatorPercentage = await getCreatorEarningPercentage(
    receiverId,
    settings.femaleEarningPercentage
  );

  const earnings = computeCreatorEarnings({
    maleCost,
    coinValue,
    creatorPercentage,
  });

  return {
    settings,
    minutes,
    type: normalizedType,
    ratePerMinute,
    femaleEarningPercentage: earnings.femaleEarningPercentage,
    maleCost,
    coinValue,
    revenue: earnings.revenue,
    femaleEarn: earnings.femaleEarn,
    femaleAmount: earnings.femaleAmount,
    platformAmount: earnings.platformAmount,
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
  const creatorRates = await getEffectiveCreatorCallRates(creatorId, settings);

  const femaleEarningPercentage = await getCreatorEarningPercentage(
    creatorId,
    settings.femaleEarningPercentage
  );

  const customRow = await getCreatorCustomRateRow(creatorId);
  const usesCustomPercentage =
    customRow?.femaleEarningPercentage !== null &&
    customRow?.femaleEarningPercentage !== undefined;

  // Base coin value reference (e.g. ₹69 / 160 coins = 0.43125)
  const baseCoinValue = DEFAULT_COIN_VALUE;

  const voiceCoinsPerMinute = creatorRates.voiceRatePerMinute;
  const voiceRevenuePerMinute = Number((voiceCoinsPerMinute * baseCoinValue).toFixed(2));
  const voiceCreatorEarnPerMinute = Number((voiceRevenuePerMinute * (femaleEarningPercentage / 100)).toFixed(2));
  const voicePlatformEarnPerMinute = Number((voiceRevenuePerMinute - voiceCreatorEarnPerMinute).toFixed(2));

  const videoCoinsPerMinute = creatorRates.videoRatePerMinute;
  const videoRevenuePerMinute = Number((videoCoinsPerMinute * baseCoinValue).toFixed(2));
  const videoCreatorEarnPerMinute = Number((videoRevenuePerMinute * (femaleEarningPercentage / 100)).toFixed(2));
  const videoPlatformEarnPerMinute = Number((videoRevenuePerMinute - videoCreatorEarnPerMinute).toFixed(2));

  return {
    voiceRatePerMinute: creatorRates.voiceRatePerMinute,
    videoRatePerMinute: creatorRates.videoRatePerMinute,
    globalVoiceRatePerMinute: settings.voiceRatePerMinute,
    globalVideoRatePerMinute: settings.videoRatePerMinute,
    usesCustomVoiceRate: creatorRates.usesCustomVoiceRate,
    usesCustomVideoRate: creatorRates.usesCustomVideoRate,
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
