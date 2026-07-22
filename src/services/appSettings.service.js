import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";

const DEFAULT_SETTINGS = {
  languageMatchingEnabled: 1,
  welcomeOfferEnabled: 1,
  welcomeOfferCoins: 100,
  authVerificationMode: "otp",
  femaleVerificationMethod: "audio",
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

  await sequelize.query(
    `INSERT IGNORE INTO admin_app_settings
(id, languageMatchingEnabled, welcomeOfferEnabled, welcomeOfferCoins, authVerificationMode, femaleVerificationMethod)
VALUES (1, :languageMatchingEnabled, :welcomeOfferEnabled, :welcomeOfferCoins, :authVerificationMode, :femaleVerificationMethod)`,
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
    updatedAt: row.updatedAt || null,
  };
};

export const updateAppSettings = async ({
  languageMatchingEnabled,
  welcomeOfferEnabled,
  welcomeOfferCoins,
  authVerificationMode,
  femaleVerificationMethod,
}) => {
  await ensureAppSettingsTable();

  const current = await getAppSettings();

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

  await sequelize.query(
    `UPDATE admin_app_settings
SET languageMatchingEnabled = :languageMatchingEnabled,
welcomeOfferEnabled = :welcomeOfferEnabled,
welcomeOfferCoins = :welcomeOfferCoins,
authVerificationMode = :authVerificationMode,
femaleVerificationMethod = :femaleVerificationMethod
WHERE id = 1`,
    {
      replacements: {
        languageMatchingEnabled: nextLanguageMatching,
        welcomeOfferEnabled: nextWelcomeOfferEnabled,
        welcomeOfferCoins: nextWelcomeOfferCoins,
        authVerificationMode: nextAuthVerificationMode,
        femaleVerificationMethod: nextFemaleVerificationMethod,
      },
    }
  );

  return getAppSettings();
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
