import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";
import {
  DEFAULT_FORCE_UPDATE_MESSAGE,
  mapForceUpdateRow,
  mergeForceUpdateSettings,
  validateForceUpdateSettings,
} from "../utils/appSettingsForceUpdate.util.js";

let ioInstance = null;

export const setSocketInstance = (io) => {
  ioInstance = io;
};

const DEFAULT_SETTINGS = {
  languageMatchingEnabled: 1,
  welcomeOfferEnabled: 1,
  welcomeOfferCoins: 100,
  authVerificationMode: "otp",
  femaleVerificationMethod: "audio",
  femaleUserCardLayout: 0,
  bonusPack1Enabled: 0,
  bonusPack1Price: 49,
  bonusPack1Coins: 120,
  bonusPack2Enabled: 0,
  bonusPack2Price: 249,
  bonusPack2Coins: 1200,
  bonusPack3Enabled: 0,
  bonusPack3Price: 549,
  bonusPack3Coins: 2000,
  lowBalanceOfferEnabled: 1,
  lowBalanceThreshold: 20,
  lowBalanceOfferPrice: 699,
  lowBalanceOfferCoins: 2500,
  lowBalanceOfferOriginalPrice: 999,
  lowBalanceOfferTitle: "Your welcome offer",
  lowBalanceOfferSubtitle: "A one-time head start to find your best friend.",
  lowBalanceOfferSocialProof: "Used by 30,505 people in the last 30 mins",
  forceUpdateEnabled: 0,
  minAndroidVersionCode: null,
  minIosBuildNumber: null,
  latestAndroidVersionCode: null,
  latestIosBuildNumber: null,
  updateMessage: DEFAULT_FORCE_UPDATE_MESSAGE,
  playStoreUrl: null,
  appStoreUrl: null,
  quickConnectEnabled: 0,
  quickConnectMaxAttempts: 3,
  quickConnectRingTimeoutSeconds: 10,
  quickConnectMaxRoutingSeconds: 30,
};

const normalizeFemaleVerificationMethod = (value) => {
  const method = String(value ?? "audio").trim().toLowerCase();
  return method === "video" ? "video" : "audio";
};

let tableReady = false;

const columnExists = async (tableName, columnName) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS columnCount
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME = :tableName
AND COLUMN_NAME = :columnName`,
    {
      replacements: {
        tableName,
        columnName,
      },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.columnCount ?? 0) > 0;
};

const ensureColumn = async (tableName, columnName, definition) => {
  const exists = await columnExists(tableName, columnName);

  if (exists) {
    return;
  }

  await sequelize.query(
    `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
  );
};

const ensureAppSettingsTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_app_settings (
id TINYINT NOT NULL PRIMARY KEY,
languageMatchingEnabled TINYINT(1) NOT NULL DEFAULT 1,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  await ensureColumn(
    "admin_app_settings",
    "welcomeOfferEnabled",
    "TINYINT(1) NOT NULL DEFAULT 1"
  );
  await ensureColumn(
    "admin_app_settings",
    "welcomeOfferCoins",
    "INT NOT NULL DEFAULT 100"
  );
  await ensureColumn(
    "admin_app_settings",
    "authVerificationMode",
    "VARCHAR(10) NOT NULL DEFAULT 'otp'"
  );
  await ensureColumn(
    "admin_app_settings",
    "femaleVerificationMethod",
    "VARCHAR(10) NOT NULL DEFAULT 'audio'"
  );
  await ensureColumn(
    "admin_app_settings",
    "femaleUserCardLayout",
    "TINYINT NOT NULL DEFAULT 0"
  );

  for (const [column, definition] of [
    ["bonusPack1Enabled", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["bonusPack1Price", "INT NOT NULL DEFAULT 49"],
    ["bonusPack1Coins", "INT NOT NULL DEFAULT 120"],
    ["bonusPack2Enabled", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["bonusPack2Price", "INT NOT NULL DEFAULT 249"],
    ["bonusPack2Coins", "INT NOT NULL DEFAULT 1200"],
    ["bonusPack3Enabled", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["bonusPack3Price", "INT NOT NULL DEFAULT 549"],
    ["bonusPack3Coins", "INT NOT NULL DEFAULT 2000"],
    ["lowBalanceOfferEnabled", "TINYINT(1) NOT NULL DEFAULT 1"],
    ["lowBalanceThreshold", "INT NOT NULL DEFAULT 20"],
    ["lowBalanceOfferPrice", "INT NOT NULL DEFAULT 699"],
    ["lowBalanceOfferCoins", "INT NOT NULL DEFAULT 2500"],
    ["lowBalanceOfferOriginalPrice", "INT NOT NULL DEFAULT 999"],
    ["lowBalanceOfferTitle", "VARCHAR(120) NOT NULL DEFAULT 'Your welcome offer'"],
    ["lowBalanceOfferSubtitle", "VARCHAR(255) NOT NULL DEFAULT 'A one-time head start to find your best friend.'"],
    ["lowBalanceOfferSocialProof", "VARCHAR(255) NOT NULL DEFAULT 'Used by 30,505 people in the last 30 mins'"],
    ["forceUpdateEnabled", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["minAndroidVersionCode", "INT NULL"],
    ["minIosBuildNumber", "INT NULL"],
    ["latestAndroidVersionCode", "INT NULL"],
    ["latestIosBuildNumber", "INT NULL"],
    ["updateMessage", "VARCHAR(500) NULL"],
    ["playStoreUrl", "VARCHAR(512) NULL"],
    ["appStoreUrl", "VARCHAR(512) NULL"],
    ["quickConnectEnabled", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["quickConnectMaxAttempts", "INT NOT NULL DEFAULT 3"],
    ["quickConnectRingTimeoutSeconds", "INT NOT NULL DEFAULT 10"],
    ["quickConnectMaxRoutingSeconds", "INT NOT NULL DEFAULT 30"],
  ]) {
    await ensureColumn("admin_app_settings", column, definition);
  }

  await sequelize.query(
    `INSERT IGNORE INTO admin_app_settings
(id, languageMatchingEnabled, welcomeOfferEnabled, welcomeOfferCoins, authVerificationMode, femaleVerificationMethod, femaleUserCardLayout,
 bonusPack1Enabled, bonusPack1Price, bonusPack1Coins,
 bonusPack2Enabled, bonusPack2Price, bonusPack2Coins,
 bonusPack3Enabled, bonusPack3Price, bonusPack3Coins,
 forceUpdateEnabled, updateMessage)
VALUES (1, :languageMatchingEnabled, :welcomeOfferEnabled, :welcomeOfferCoins, :authVerificationMode, :femaleVerificationMethod, :femaleUserCardLayout,
 :bonusPack1Enabled, :bonusPack1Price, :bonusPack1Coins,
 :bonusPack2Enabled, :bonusPack2Price, :bonusPack2Coins,
 :bonusPack3Enabled, :bonusPack3Price, :bonusPack3Coins,
 :forceUpdateEnabled, :updateMessage)`,
    {
      replacements: DEFAULT_SETTINGS,
    }
  );

  tableReady = true;
};

export const getAppSettings = async () => {
  await ensureAppSettingsTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_app_settings WHERE id = 1 LIMIT 1",
    {
      type: QueryTypes.SELECT,
    }
  );

  const row = rows[0] || DEFAULT_SETTINGS;
  const forceUpdate = mapForceUpdateRow(row);

  return {
    languageMatchingEnabled: Boolean(
      Number(row.languageMatchingEnabled ?? 1)
    ),
    welcomeOfferEnabled: Boolean(
      Number(row.welcomeOfferEnabled ?? 1)
    ),
    welcomeOfferCoins: Number(row.welcomeOfferCoins ?? 100) || 100,
    authVerificationMode:
      String(row.authVerificationMode ?? "otp").toLowerCase() === "pin"
        ? "pin"
        : "otp",
    femaleVerificationMethod: normalizeFemaleVerificationMethod(
      row.femaleVerificationMethod
    ),
    femaleUserCardLayout: Number(row.femaleUserCardLayout ?? 0),
    bonusPack1Enabled: Boolean(Number(row.bonusPack1Enabled ?? 0)),
    bonusPack1Price: Number(row.bonusPack1Price ?? 49) || 49,
    bonusPack1Coins: Number(row.bonusPack1Coins ?? 120) || 120,
    bonusPack2Enabled: Boolean(Number(row.bonusPack2Enabled ?? 0)),
    bonusPack2Price: Number(row.bonusPack2Price ?? 249) || 249,
    bonusPack2Coins: Number(row.bonusPack2Coins ?? 1200) || 1200,
    bonusPack3Enabled: Boolean(Number(row.bonusPack3Enabled ?? 0)),
    bonusPack3Price: Number(row.bonusPack3Price ?? 549) || 549,
    bonusPack3Coins: Number(row.bonusPack3Coins ?? 2000) || 2000,
    lowBalanceOfferEnabled: Boolean(Number(row.lowBalanceOfferEnabled ?? 1)),
    lowBalanceThreshold: Number(row.lowBalanceThreshold ?? 20) || 20,
    lowBalanceOfferPrice: Number(row.lowBalanceOfferPrice ?? 699) || 699,
    lowBalanceOfferCoins: Number(row.lowBalanceOfferCoins ?? 2500) || 2500,
    lowBalanceOfferOriginalPrice:
      Number(row.lowBalanceOfferOriginalPrice ?? 999) || 999,
    lowBalanceOfferTitle:
      String(row.lowBalanceOfferTitle ?? "Your welcome offer").trim() ||
      "Your welcome offer",
    lowBalanceOfferSubtitle:
      String(
        row.lowBalanceOfferSubtitle ??
          "A one-time head start to find your best friend."
      ).trim() ||
      "A one-time head start to find your best friend.",
    lowBalanceOfferSocialProof:
      String(
        row.lowBalanceOfferSocialProof ??
          "Used by 30,505 people in the last 30 mins"
      ).trim() ||
      "Used by 30,505 people in the last 30 mins",
    quickConnectEnabled: Boolean(Number(row.quickConnectEnabled ?? 0)),
    quickConnectMaxAttempts: Math.min(
      5,
      Math.max(1, Number(row.quickConnectMaxAttempts ?? 3) || 3)
    ),
    quickConnectRingTimeoutSeconds: Math.min(
      30,
      Math.max(5, Number(row.quickConnectRingTimeoutSeconds ?? 10) || 10)
    ),
    quickConnectMaxRoutingSeconds: Math.min(
      60,
      Math.max(10, Number(row.quickConnectMaxRoutingSeconds ?? 30) || 30)
    ),
    ...forceUpdate,
    updatedAt: row.updatedAt || null,
  };
};

export const updateAppSettings = async ({
  languageMatchingEnabled,
  welcomeOfferEnabled,
  welcomeOfferCoins,
  authVerificationMode,
  femaleVerificationMethod,
  femaleUserCardLayout,
  bonusPack1Enabled,
  bonusPack1Price,
  bonusPack1Coins,
  bonusPack2Enabled,
  bonusPack2Price,
  bonusPack2Coins,
  bonusPack3Enabled,
  bonusPack3Price,
  bonusPack3Coins,
  lowBalanceOfferEnabled,
  lowBalanceThreshold,
  lowBalanceOfferPrice,
  lowBalanceOfferCoins,
  lowBalanceOfferOriginalPrice,
  lowBalanceOfferTitle,
  lowBalanceOfferSubtitle,
  lowBalanceOfferSocialProof,
  quickConnectEnabled,
  quickConnectMaxAttempts,
  quickConnectRingTimeoutSeconds,
  quickConnectMaxRoutingSeconds,
  forceUpdateEnabled,
  minAndroidVersionCode,
  minIosBuildNumber,
  latestAndroidVersionCode,
  latestIosBuildNumber,
  updateMessage,
  playStoreUrl,
  appStoreUrl,
}) => {
  await ensureAppSettingsTable();

  const current = await getAppSettings();
  const nextForceUpdate = mergeForceUpdateSettings(current, {
    forceUpdateEnabled,
    minAndroidVersionCode,
    minIosBuildNumber,
    latestAndroidVersionCode,
    latestIosBuildNumber,
    updateMessage,
    playStoreUrl,
    appStoreUrl,
  });

  const validationErrors = validateForceUpdateSettings(nextForceUpdate);

  if (validationErrors.length > 0) {
    const error = new Error(validationErrors[0]);
    error.statusCode = 400;
    error.details = validationErrors;
    throw error;
  }

  const nextLanguageMatching =
    languageMatchingEnabled === undefined
      ? current.languageMatchingEnabled
        ? 1
        : 0
      : languageMatchingEnabled
        ? 1
        : 0;

  const nextWelcomeOfferEnabled =
    welcomeOfferEnabled === undefined
      ? current.welcomeOfferEnabled
        ? 1
        : 0
      : welcomeOfferEnabled
        ? 1
        : 0;

  const parsedCoins = Number(welcomeOfferCoins);
  const nextWelcomeOfferCoins =
    welcomeOfferCoins === undefined
      ? current.welcomeOfferCoins
      : Number.isFinite(parsedCoins) && parsedCoins > 0
        ? Math.round(parsedCoins)
        : current.welcomeOfferCoins;

  const nextAuthVerificationMode =
    authVerificationMode === undefined
      ? current.authVerificationMode
      : String(authVerificationMode).toLowerCase() === "pin"
        ? "pin"
        : "otp";

  const nextFemaleVerificationMethod =
    femaleVerificationMethod === undefined
      ? current.femaleVerificationMethod
      : normalizeFemaleVerificationMethod(femaleVerificationMethod);

  const parsedLayout = Number(femaleUserCardLayout);
  const nextFemaleUserCardLayout =
    femaleUserCardLayout === undefined
      ? current.femaleUserCardLayout
      : Number.isFinite(parsedLayout) && parsedLayout >= 0
        ? Math.round(parsedLayout)
        : current.femaleUserCardLayout;

  const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
  };

  const nextBonusPack1Enabled =
    bonusPack1Enabled === undefined
      ? current.bonusPack1Enabled
        ? 1
        : 0
      : bonusPack1Enabled
        ? 1
        : 0;
  const nextBonusPack2Enabled =
    bonusPack2Enabled === undefined
      ? current.bonusPack2Enabled
        ? 1
        : 0
      : bonusPack2Enabled
        ? 1
        : 0;
  const nextBonusPack3Enabled =
    bonusPack3Enabled === undefined
      ? current.bonusPack3Enabled
        ? 1
        : 0
      : bonusPack3Enabled
        ? 1
        : 0;

  const nextBonusPack1Price =
    bonusPack1Price === undefined
      ? current.bonusPack1Price
      : parsePositiveInt(bonusPack1Price, current.bonusPack1Price);
  const nextBonusPack1Coins =
    bonusPack1Coins === undefined
      ? current.bonusPack1Coins
      : parsePositiveInt(bonusPack1Coins, current.bonusPack1Coins);
  const nextBonusPack2Price =
    bonusPack2Price === undefined
      ? current.bonusPack2Price
      : parsePositiveInt(bonusPack2Price, current.bonusPack2Price);
  const nextBonusPack2Coins =
    bonusPack2Coins === undefined
      ? current.bonusPack2Coins
      : parsePositiveInt(bonusPack2Coins, current.bonusPack2Coins);
  const nextBonusPack3Price =
    bonusPack3Price === undefined
      ? current.bonusPack3Price
      : parsePositiveInt(bonusPack3Price, current.bonusPack3Price);
  const nextBonusPack3Coins =
    bonusPack3Coins === undefined
      ? current.bonusPack3Coins
      : parsePositiveInt(bonusPack3Coins, current.bonusPack3Coins);

  const nextLowBalanceOfferEnabled =
    lowBalanceOfferEnabled === undefined
      ? current.lowBalanceOfferEnabled
        ? 1
        : 0
      : lowBalanceOfferEnabled
        ? 1
        : 0;

  const nextLowBalanceThreshold =
    lowBalanceThreshold === undefined
      ? current.lowBalanceThreshold
      : parsePositiveInt(lowBalanceThreshold, current.lowBalanceThreshold);

  const nextLowBalanceOfferPrice =
    lowBalanceOfferPrice === undefined
      ? current.lowBalanceOfferPrice
      : parsePositiveInt(lowBalanceOfferPrice, current.lowBalanceOfferPrice);

  const nextLowBalanceOfferCoins =
    lowBalanceOfferCoins === undefined
      ? current.lowBalanceOfferCoins
      : parsePositiveInt(lowBalanceOfferCoins, current.lowBalanceOfferCoins);

  const nextLowBalanceOfferOriginalPrice =
    lowBalanceOfferOriginalPrice === undefined
      ? current.lowBalanceOfferOriginalPrice
      : parsePositiveInt(
          lowBalanceOfferOriginalPrice,
          current.lowBalanceOfferOriginalPrice
        );

  const nextLowBalanceOfferTitle =
    lowBalanceOfferTitle === undefined
      ? current.lowBalanceOfferTitle
      : String(lowBalanceOfferTitle).trim().slice(0, 120) ||
        current.lowBalanceOfferTitle;

  const nextLowBalanceOfferSubtitle =
    lowBalanceOfferSubtitle === undefined
      ? current.lowBalanceOfferSubtitle
      : String(lowBalanceOfferSubtitle).trim().slice(0, 255) ||
        current.lowBalanceOfferSubtitle;

  const nextLowBalanceOfferSocialProof =
    lowBalanceOfferSocialProof === undefined
      ? current.lowBalanceOfferSocialProof
      : String(lowBalanceOfferSocialProof).trim().slice(0, 255) ||
        current.lowBalanceOfferSocialProof;

  const nextQuickConnectEnabled =
    quickConnectEnabled === undefined
      ? current.quickConnectEnabled
        ? 1
        : 0
      : quickConnectEnabled
        ? 1
        : 0;

  const nextQuickConnectMaxAttempts = Math.min(
    5,
    Math.max(
      1,
      quickConnectMaxAttempts === undefined
        ? current.quickConnectMaxAttempts
        : parsePositiveInt(quickConnectMaxAttempts, current.quickConnectMaxAttempts)
    )
  );

  const nextQuickConnectRingTimeoutSeconds = Math.min(
    30,
    Math.max(
      5,
      quickConnectRingTimeoutSeconds === undefined
        ? current.quickConnectRingTimeoutSeconds
        : parsePositiveInt(
            quickConnectRingTimeoutSeconds,
            current.quickConnectRingTimeoutSeconds
          )
    )
  );

  const nextQuickConnectMaxRoutingSeconds = Math.min(
    60,
    Math.max(
      10,
      quickConnectMaxRoutingSeconds === undefined
        ? current.quickConnectMaxRoutingSeconds
        : parsePositiveInt(
            quickConnectMaxRoutingSeconds,
            current.quickConnectMaxRoutingSeconds
          )
    )
  );

  await sequelize.query(
    `UPDATE admin_app_settings
SET languageMatchingEnabled = :languageMatchingEnabled,
welcomeOfferEnabled = :welcomeOfferEnabled,
welcomeOfferCoins = :welcomeOfferCoins,
authVerificationMode = :authVerificationMode,
femaleVerificationMethod = :femaleVerificationMethod,
femaleUserCardLayout = :femaleUserCardLayout,
bonusPack1Enabled = :bonusPack1Enabled,
bonusPack1Price = :bonusPack1Price,
bonusPack1Coins = :bonusPack1Coins,
bonusPack2Enabled = :bonusPack2Enabled,
bonusPack2Price = :bonusPack2Price,
bonusPack2Coins = :bonusPack2Coins,
bonusPack3Enabled = :bonusPack3Enabled,
bonusPack3Price = :bonusPack3Price,
bonusPack3Coins = :bonusPack3Coins,
lowBalanceOfferEnabled = :lowBalanceOfferEnabled,
lowBalanceThreshold = :lowBalanceThreshold,
lowBalanceOfferPrice = :lowBalanceOfferPrice,
lowBalanceOfferCoins = :lowBalanceOfferCoins,
lowBalanceOfferOriginalPrice = :lowBalanceOfferOriginalPrice,
lowBalanceOfferTitle = :lowBalanceOfferTitle,
lowBalanceOfferSubtitle = :lowBalanceOfferSubtitle,
lowBalanceOfferSocialProof = :lowBalanceOfferSocialProof,
quickConnectEnabled = :quickConnectEnabled,
quickConnectMaxAttempts = :quickConnectMaxAttempts,
quickConnectRingTimeoutSeconds = :quickConnectRingTimeoutSeconds,
quickConnectMaxRoutingSeconds = :quickConnectMaxRoutingSeconds,
forceUpdateEnabled = :forceUpdateEnabled,
minAndroidVersionCode = :minAndroidVersionCode,
minIosBuildNumber = :minIosBuildNumber,
latestAndroidVersionCode = :latestAndroidVersionCode,
latestIosBuildNumber = :latestIosBuildNumber,
updateMessage = :updateMessage,
playStoreUrl = :playStoreUrl,
appStoreUrl = :appStoreUrl
WHERE id = 1`,
    {
      replacements: {
        languageMatchingEnabled: nextLanguageMatching,
        welcomeOfferEnabled: nextWelcomeOfferEnabled,
        welcomeOfferCoins: nextWelcomeOfferCoins,
        authVerificationMode: nextAuthVerificationMode,
        femaleVerificationMethod: nextFemaleVerificationMethod,
        femaleUserCardLayout: nextFemaleUserCardLayout,
        bonusPack1Enabled: nextBonusPack1Enabled,
        bonusPack1Price: nextBonusPack1Price,
        bonusPack1Coins: nextBonusPack1Coins,
        bonusPack2Enabled: nextBonusPack2Enabled,
        bonusPack2Price: nextBonusPack2Price,
        bonusPack2Coins: nextBonusPack2Coins,
        bonusPack3Enabled: nextBonusPack3Enabled,
        bonusPack3Price: nextBonusPack3Price,
        bonusPack3Coins: nextBonusPack3Coins,
        lowBalanceOfferEnabled: nextLowBalanceOfferEnabled,
        lowBalanceThreshold: nextLowBalanceThreshold,
        lowBalanceOfferPrice: nextLowBalanceOfferPrice,
        lowBalanceOfferCoins: nextLowBalanceOfferCoins,
        lowBalanceOfferOriginalPrice: nextLowBalanceOfferOriginalPrice,
        lowBalanceOfferTitle: nextLowBalanceOfferTitle,
        lowBalanceOfferSubtitle: nextLowBalanceOfferSubtitle,
        lowBalanceOfferSocialProof: nextLowBalanceOfferSocialProof,
        quickConnectEnabled: nextQuickConnectEnabled,
        quickConnectMaxAttempts: nextQuickConnectMaxAttempts,
        quickConnectRingTimeoutSeconds: nextQuickConnectRingTimeoutSeconds,
        quickConnectMaxRoutingSeconds: nextQuickConnectMaxRoutingSeconds,
        forceUpdateEnabled: nextForceUpdate.forceUpdateEnabled ? 1 : 0,
        minAndroidVersionCode: nextForceUpdate.minAndroidVersionCode,
        minIosBuildNumber: nextForceUpdate.minIosBuildNumber,
        latestAndroidVersionCode: nextForceUpdate.latestAndroidVersionCode,
        latestIosBuildNumber: nextForceUpdate.latestIosBuildNumber,
        updateMessage: nextForceUpdate.updateMessage,
        playStoreUrl: nextForceUpdate.playStoreUrl,
        appStoreUrl: nextForceUpdate.appStoreUrl,
      },
    }
  );

  const updatedSettings = await getAppSettings();

  if (ioInstance) {
    try {
      ioInstance.emit("app-settings-updated", { settings: updatedSettings });
    } catch (_e) {}
  }

  return updatedSettings;
};

export const isLanguageMatchingEnabled = async () => {
  const settings = await getAppSettings();
  return settings.languageMatchingEnabled;
};

export const normalizeLanguage = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export const parseLanguages = (languages) => {
  if (Array.isArray(languages)) {
    return languages
      .map(normalizeLanguage)
      .filter(Boolean);
  }

  if (typeof languages === "string") {
    const trimmed = languages.trim();

    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizeLanguage)
          .filter(Boolean);
      }
    } catch {
      // fall through to comma split
    }

    return trimmed
      .split(",")
      .map(normalizeLanguage)
      .filter(Boolean);
  }

  return [];
};

export const languagesOverlap = (
  requesterLanguages,
  candidateLanguages
) => {
  const requesterSet = new Set(
    parseLanguages(requesterLanguages)
  );
  const candidateList = parseLanguages(
    candidateLanguages
  );

  if (!requesterSet.size || !candidateList.length) {
    return false;
  }

  return candidateList.some((language) =>
    requesterSet.has(language)
  );
};
