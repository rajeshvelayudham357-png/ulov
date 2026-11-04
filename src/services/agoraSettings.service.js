import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";

const DEFAULT_TOKEN_EXPIRY_SECONDS = 3600;

// Credentials come only from the admin_agora_settings row or the environment.
// There is deliberately no hard-coded fallback.
const getEnvSettings = () => ({
  appId: String(process.env.AGORA_APP_ID || "").trim(),
  appCertificate: String(process.env.AGORA_APP_CERTIFICATE || "").trim(),
  tokenExpirySeconds:
    Number(process.env.TOKEN_EXPIRY) || DEFAULT_TOKEN_EXPIRY_SECONDS,
});

let tableReady = false;
let missingCredentialsWarned = false;

const maskSecret = (value) => {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (text.length <= 4) {
    return "****";
  }
  return `${"*".repeat(Math.min(text.length - 4, 12))}${text.slice(-4)}`;
};

const normalizeAppId = (value) => String(value || "").trim();

const normalizeTokenExpiry = (value, fallback) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(86400, Math.max(60, Math.round(parsed)));
};

const ensureAgoraSettingsTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_agora_settings (
id TINYINT NOT NULL PRIMARY KEY,
appId VARCHAR(64) NOT NULL DEFAULT '',
appCertificate VARCHAR(128) NOT NULL DEFAULT '',
tokenExpirySeconds INT NOT NULL DEFAULT 3600,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_agora_settings
(id, appId, appCertificate, tokenExpirySeconds)
VALUES (1, :appId, :appCertificate, :tokenExpirySeconds)`,
    {
      replacements: getEnvSettings(),
    }
  );

  tableReady = true;
};

const readRow = async () => {
  await ensureAgoraSettingsTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_agora_settings WHERE id = 1 LIMIT 1",
    {
      type: QueryTypes.SELECT,
    }
  );

  return rows[0] || {};
};

export const getAgoraSettings = async () => {
  const row = await readRow();
  const env = getEnvSettings();

  const appId = normalizeAppId(row.appId) || env.appId;

  const appCertificate =
    String(row.appCertificate || "").trim() || env.appCertificate;

  const tokenExpirySeconds = normalizeTokenExpiry(
    row.tokenExpirySeconds ?? env.tokenExpirySeconds,
    DEFAULT_TOKEN_EXPIRY_SECONDS
  );

  if ((!appId || !appCertificate) && !missingCredentialsWarned) {
    missingCredentialsWarned = true;
    console.warn(
      "AGORA CREDENTIALS MISSING: set AGORA_APP_ID / AGORA_APP_CERTIFICATE or configure them in admin settings"
    );
  }

  return {
    appId,
    appCertificate,
    tokenExpirySeconds,
    updatedAt: row.updatedAt || null,
  };
};

export const getPublicAgoraConfig = async () => {
  const settings = await getAgoraSettings();

  return {
    appId: settings.appId,
  };
};

export const getAdminAgoraSettingsView = async () => {
  const settings = await getAgoraSettings();

  return {
    appId: settings.appId,
    appCertificateMasked: maskSecret(settings.appCertificate),
    appCertificateConfigured: Boolean(settings.appCertificate),
    tokenExpirySeconds: settings.tokenExpirySeconds,
    updatedAt: settings.updatedAt,
  };
};

export const updateAgoraSettings = async (payload = {}) => {
  const current = await getAgoraSettings();

  const nextAppId =
    payload.appId !== undefined
      ? normalizeAppId(payload.appId)
      : current.appId;

  const nextAppCertificate =
    payload.appCertificate !== undefined &&
    String(payload.appCertificate || "").trim() !== ""
      ? String(payload.appCertificate).trim()
      : current.appCertificate;

  const nextTokenExpirySeconds =
    payload.tokenExpirySeconds !== undefined
      ? normalizeTokenExpiry(
          payload.tokenExpirySeconds,
          current.tokenExpirySeconds
        )
      : current.tokenExpirySeconds;

  if (!nextAppId) {
    throw new Error("Agora App ID is required.");
  }

  if (!/^[a-f0-9]{32}$/i.test(nextAppId)) {
    throw new Error("Agora App ID must be a 32-character hexadecimal string.");
  }

  if (!nextAppCertificate) {
    throw new Error("Agora App Certificate is required.");
  }

  if (!/^[a-f0-9]{32}$/i.test(nextAppCertificate)) {
    throw new Error(
      "Agora App Certificate must be a 32-character hexadecimal string."
    );
  }

  await sequelize.query(
    `UPDATE admin_agora_settings
SET appId = :appId,
appCertificate = :appCertificate,
tokenExpirySeconds = :tokenExpirySeconds
WHERE id = 1`,
    {
      replacements: {
        appId: nextAppId,
        appCertificate: nextAppCertificate,
        tokenExpirySeconds: nextTokenExpirySeconds,
      },
    }
  );

  return getAdminAgoraSettingsView();
};
