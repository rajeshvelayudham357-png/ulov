import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";
import { ensurePaymentDatabaseSchemas } from "./paymentSchema.service.js";

const DEFAULT_SETTINGS = {
  activeGateway: "cashfree",
  cashfreeEnv: "sandbox",
  razorpayEnv: "test",
  googlePlayEnabled: true,
  googlePlayEnv: "test",
};

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

const normalizeGateway = (value) => {
  const gateway = String(value || "")
    .trim()
    .toLowerCase();

  if (gateway === "razorpay") {
    return "razorpay";
  }
  if (gateway === "google_play") {
    return "google_play";
  }
  if (gateway === "apple_iap") {
    return "apple_iap";
  }

  return "cashfree";
};

const readRow = async () => {
  await ensurePaymentDatabaseSchemas();

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

  const googlePlayEnabled = Boolean(
    row.googlePlayEnabled ?? DEFAULT_SETTINGS.googlePlayEnabled
  );
  const googlePlayEnv = (
    row.googlePlayEnv ||
    process.env.GOOGLE_PLAY_ENV ||
    DEFAULT_SETTINGS.googlePlayEnv
  ).toLowerCase();
  const googlePlayPackageName =
    row.googlePlayPackageName ||
    process.env.GOOGLE_PLAY_PACKAGE_NAME ||
    "com.ulov.app";
  const googlePlayServiceAccountEmail =
    row.googlePlayServiceAccountEmail ||
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL ||
    "";
  const googlePlayProjectId =
    row.googlePlayProjectId ||
    process.env.GOOGLE_PLAY_PROJECT_ID ||
    "";
  const googlePlayProjectNumber =
    row.googlePlayProjectNumber ||
    process.env.GOOGLE_PLAY_PROJECT_NUMBER ||
    "";
  const googlePlayApiEnabled = Boolean(row.googlePlayApiEnabled);
  const googlePlayNotes = row.googlePlayNotes || "";

  return {
    activeGateway: normalizeGateway(
      row.activeGateway || DEFAULT_SETTINGS.activeGateway
    ),
    cashfreeClientId,
    cashfreeClientSecret,
    cashfreeEnv: cashfreeEnv === "production" ? "production" : "sandbox",
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
    razorpayEnv: razorpayEnv === "live" ? "live" : "test",
    googlePlayEnabled,
    googlePlayEnv: googlePlayEnv === "production" ? "production" : "test",
    googlePlayPackageName,
    googlePlayServiceAccountEmail,
    googlePlayProjectId,
    googlePlayProjectNumber,
    googlePlayApiEnabled,
    googlePlayNotes,
    updatedAt: row.updatedAt || null,
  };
};

export const getPublicPaymentConfig = async () => {
  const settings = await getPaymentSettings();

  return {
    provider: settings.activeGateway,
    activeGateway: settings.activeGateway,
    cashfreeMode:
      settings.cashfreeEnv === "production" ? "production" : "sandbox",
    razorpayMode: settings.razorpayEnv,
    razorpayKeyId:
      settings.activeGateway === "razorpay"
        ? settings.razorpayKeyId
        : undefined,
    googlePlayMode: settings.googlePlayEnv,
    googlePlayPackageName: settings.googlePlayPackageName,
    googlePlayEnabled: settings.googlePlayEnabled,
  };
};

export const getAdminPaymentSettingsView = async () => {
  const settings = await getPaymentSettings();

  return {
    activeGateway: settings.activeGateway,
    cashfreeClientId: settings.cashfreeClientId,
    cashfreeClientSecretMasked: maskSecret(settings.cashfreeClientSecret),
    cashfreeClientSecretConfigured: Boolean(settings.cashfreeClientSecret),
    cashfreeEnv: settings.cashfreeEnv,
    razorpayKeyId: settings.razorpayKeyId,
    razorpayKeySecretMasked: maskSecret(settings.razorpayKeySecret),
    razorpayKeySecretConfigured: Boolean(settings.razorpayKeySecret),
    razorpayWebhookSecretMasked: maskSecret(settings.razorpayWebhookSecret),
    razorpayWebhookSecretConfigured: Boolean(settings.razorpayWebhookSecret),
    razorpayEnv: settings.razorpayEnv,
    googlePlayEnabled: settings.googlePlayEnabled,
    googlePlayEnv: settings.googlePlayEnv,
    googlePlayPackageName: settings.googlePlayPackageName,
    googlePlayServiceAccountEmail: settings.googlePlayServiceAccountEmail,
    googlePlayProjectId: settings.googlePlayProjectId,
    googlePlayProjectNumber: settings.googlePlayProjectNumber,
    googlePlayApiEnabled: settings.googlePlayApiEnabled,
    googlePlayNotes: settings.googlePlayNotes,
    updatedAt: settings.updatedAt,
  };
};

export const updatePaymentSettings = async (payload = {}) => {
  await ensurePaymentDatabaseSchemas();
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
      String(payload.cashfreeEnv ?? current.cashfreeEnv).toLowerCase() === "production"
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
      String(payload.razorpayEnv ?? current.razorpayEnv).toLowerCase() === "live"
        ? "live"
        : "test",
    googlePlayEnabled:
      payload.googlePlayEnabled !== undefined
        ? Boolean(payload.googlePlayEnabled)
        : current.googlePlayEnabled,
    googlePlayEnv:
      String(payload.googlePlayEnv ?? current.googlePlayEnv).toLowerCase() === "production"
        ? "production"
        : "test",
    googlePlayPackageName:
      payload.googlePlayPackageName !== undefined
        ? String(payload.googlePlayPackageName || "").trim()
        : current.googlePlayPackageName,
    googlePlayServiceAccountEmail:
      payload.googlePlayServiceAccountEmail !== undefined
        ? String(payload.googlePlayServiceAccountEmail || "").trim()
        : current.googlePlayServiceAccountEmail,
    googlePlayProjectId:
      payload.googlePlayProjectId !== undefined
        ? String(payload.googlePlayProjectId || "").trim()
        : current.googlePlayProjectId,
    googlePlayProjectNumber:
      payload.googlePlayProjectNumber !== undefined
        ? String(payload.googlePlayProjectNumber || "").trim()
        : current.googlePlayProjectNumber,
    googlePlayApiEnabled:
      payload.googlePlayApiEnabled !== undefined
        ? Boolean(payload.googlePlayApiEnabled)
        : current.googlePlayApiEnabled,
    googlePlayNotes:
      payload.googlePlayNotes !== undefined
        ? String(payload.googlePlayNotes || "").trim()
        : current.googlePlayNotes,
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
         razorpayEnv = :razorpayEnv,
         googlePlayEnabled = :googlePlayEnabled,
         googlePlayEnv = :googlePlayEnv,
         googlePlayPackageName = :googlePlayPackageName,
         googlePlayServiceAccountEmail = :googlePlayServiceAccountEmail,
         googlePlayProjectId = :googlePlayProjectId,
         googlePlayProjectNumber = :googlePlayProjectNumber,
         googlePlayApiEnabled = :googlePlayApiEnabled,
         googlePlayNotes = :googlePlayNotes
     WHERE id = 1`,
    {
      replacements: next,
    }
  );

  return getAdminPaymentSettingsView();
};
