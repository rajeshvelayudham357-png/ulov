import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

const DEFAULT_SETTINGS = {
  activeGateway: "cashfree",
  cashfreeEnv: "sandbox",
  razorpayEnv: "test",
};

let tableReady = false;

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

const ensurePaymentSettingsTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_payment_settings (
id TINYINT NOT NULL PRIMARY KEY,
activeGateway VARCHAR(30) NOT NULL DEFAULT 'cashfree',
cashfreeClientId TEXT NULL,
cashfreeClientSecret TEXT NULL,
cashfreeEnv VARCHAR(20) NOT NULL DEFAULT 'sandbox',
razorpayKeyId TEXT NULL,
razorpayKeySecret TEXT NULL,
razorpayWebhookSecret TEXT NULL,
razorpayEnv VARCHAR(20) NOT NULL DEFAULT 'test',
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_payment_settings
(id, activeGateway, cashfreeEnv, razorpayEnv)
VALUES (1, :activeGateway, :cashfreeEnv, :razorpayEnv)`,
    {
      replacements: DEFAULT_SETTINGS,
    }
  );

  tableReady = true;
};

const normalizeGateway = (value) => {
  const gateway = String(value || "")
    .trim()
    .toLowerCase();

  if (gateway === "razorpay") {
    return "razorpay";
  }

  return "cashfree";
};

const readRow = async () => {
  await ensurePaymentSettingsTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_payment_settings WHERE id = 1 LIMIT 1",
    {
      type: QueryTypes.SELECT,
    }
  );

  return rows[0] || {};
};

export const getPaymentSettings = async () => {
  const row = await readRow();

  const cashfreeClientId =
    row.cashfreeClientId ||
    process.env.CASHFREE_CLIENT_ID ||
    "";
  const cashfreeClientSecret =
    row.cashfreeClientSecret ||
    process.env.CASHFREE_CLIENT_SECRET ||
    "";
  const cashfreeEnv = (
    row.cashfreeEnv ||
    process.env.CASHFREE_ENV ||
    DEFAULT_SETTINGS.cashfreeEnv
  ).toLowerCase();

  const razorpayKeyId =
    row.razorpayKeyId ||
    process.env.RAZORPAY_KEY_ID ||
    "";
  const razorpayKeySecret =
    row.razorpayKeySecret ||
    process.env.RAZORPAY_KEY_SECRET ||
    "";
  const razorpayWebhookSecret =
    row.razorpayWebhookSecret ||
    process.env.RAZORPAY_WEBHOOK_SECRET ||
    "";
  const razorpayEnv = (
    row.razorpayEnv ||
    process.env.RAZORPAY_ENV ||
    DEFAULT_SETTINGS.razorpayEnv
  ).toLowerCase();

  return {
    activeGateway: normalizeGateway(
      row.activeGateway || DEFAULT_SETTINGS.activeGateway
    ),
    cashfreeClientId,
    cashfreeClientSecret,
    cashfreeEnv:
      cashfreeEnv === "production" ? "production" : "sandbox",
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
    razorpayEnv: razorpayEnv === "live" ? "live" : "test",
    updatedAt: row.updatedAt || null,
  };
};

export const getPublicPaymentConfig = async () => {
  const settings = await getPaymentSettings();

  return {
    activeGateway: settings.activeGateway,
    cashfreeMode:
      settings.cashfreeEnv === "production"
        ? "production"
        : "sandbox",
    razorpayMode: settings.razorpayEnv,
    razorpayKeyId:
      settings.activeGateway === "razorpay"
        ? settings.razorpayKeyId
        : undefined,
  };
};

export const getAdminPaymentSettingsView = async () => {
  const settings = await getPaymentSettings();

  return {
    activeGateway: settings.activeGateway,
    cashfreeClientId: settings.cashfreeClientId,
    cashfreeClientSecretMasked: maskSecret(
      settings.cashfreeClientSecret
    ),
    cashfreeClientSecretConfigured: Boolean(
      settings.cashfreeClientSecret
    ),
    cashfreeEnv: settings.cashfreeEnv,
    razorpayKeyId: settings.razorpayKeyId,
    razorpayKeySecretMasked: maskSecret(
      settings.razorpayKeySecret
    ),
    razorpayKeySecretConfigured: Boolean(
      settings.razorpayKeySecret
    ),
    razorpayWebhookSecretMasked: maskSecret(
      settings.razorpayWebhookSecret
    ),
    razorpayWebhookSecretConfigured: Boolean(
      settings.razorpayWebhookSecret
    ),
    razorpayEnv: settings.razorpayEnv,
    updatedAt: settings.updatedAt,
  };
};

export const updatePaymentSettings = async (payload = {}) => {
  await ensurePaymentSettingsTable();
  const current = await getPaymentSettings();

  const next = {
    activeGateway: normalizeGateway(
      payload.activeGateway ?? current.activeGateway
    ),
    cashfreeClientId:
      payload.cashfreeClientId !== undefined
        ? String(payload.cashfreeClientId || "").trim()
        : current.cashfreeClientId,
    cashfreeClientSecret:
      payload.cashfreeClientSecret !== undefined &&
      String(payload.cashfreeClientSecret || "").trim() !== ""
        ? String(payload.cashfreeClientSecret).trim()
        : current.cashfreeClientSecret,
    cashfreeEnv:
      String(
        payload.cashfreeEnv ?? current.cashfreeEnv
      ).toLowerCase() === "production"
        ? "production"
        : "sandbox",
    razorpayKeyId:
      payload.razorpayKeyId !== undefined
        ? String(payload.razorpayKeyId || "").trim()
        : current.razorpayKeyId,
    razorpayKeySecret:
      payload.razorpayKeySecret !== undefined &&
      String(payload.razorpayKeySecret || "").trim() !== ""
        ? String(payload.razorpayKeySecret).trim()
        : current.razorpayKeySecret,
    razorpayWebhookSecret:
      payload.razorpayWebhookSecret !== undefined &&
      String(payload.razorpayWebhookSecret || "").trim() !== ""
        ? String(payload.razorpayWebhookSecret).trim()
        : current.razorpayWebhookSecret,
    razorpayEnv:
      String(
        payload.razorpayEnv ?? current.razorpayEnv
      ).toLowerCase() === "live"
        ? "live"
        : "test",
  };

  await sequelize.query(
    `UPDATE admin_payment_settings
SET activeGateway = :activeGateway,
cashfreeClientId = :cashfreeClientId,
cashfreeClientSecret = :cashfreeClientSecret,
cashfreeEnv = :cashfreeEnv,
razorpayKeyId = :razorpayKeyId,
razorpayKeySecret = :razorpayKeySecret,
razorpayWebhookSecret = :razorpayWebhookSecret,
razorpayEnv = :razorpayEnv
WHERE id = 1`,
    {
      replacements: next,
    }
  );

  return getAdminPaymentSettingsView();
};
