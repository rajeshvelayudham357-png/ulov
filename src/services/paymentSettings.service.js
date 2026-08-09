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
  if (gateway === "payu") {
    return "payu";
  }
  if (gateway === "phonepe") {
    return "phonepe";
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

  const payuMerchantKey = row.payuMerchantKey || process.env.PAYU_MERCHANT_KEY || "";
  const payuMerchantSalt = row.payuMerchantSalt || process.env.PAYU_MERCHANT_SALT || "";
  const payuMerchantId = row.payuMerchantId || process.env.PAYU_MERCHANT_ID || "";
  const payuEnv = (row.payuEnv || process.env.PAYU_ENV || "test").toLowerCase();
  const payuWebhookSecret = row.payuWebhookSecret || process.env.PAYU_WEBHOOK_SECRET || "";
  const payuSuccessUrl = row.payuSuccessUrl || "";
  const payuFailureUrl = row.payuFailureUrl || "";

  const phonepeMerchantId = row.phonepeMerchantId || process.env.PHONEPE_MERCHANT_ID || "";
  const phonepeClientId = row.phonepeClientId || process.env.PHONEPE_CLIENT_ID || "";
  const phonepeClientSecret = row.phonepeClientSecret || process.env.PHONEPE_CLIENT_SECRET || "";
  const phonepeClientVersion = row.phonepeClientVersion || process.env.PHONEPE_CLIENT_VERSION || "1";
  const phonepeEnv = (row.phonepeEnv || process.env.PHONEPE_ENV || "sandbox").toLowerCase();
  const phonepeWebhookSecret = row.phonepeWebhookSecret || process.env.PHONEPE_WEBHOOK_SECRET || "";
  const phonepeSuccessUrl = row.phonepeSuccessUrl || "";
  const phonepeFailureUrl = row.phonepeFailureUrl || "";

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
    payuMerchantKey,
    payuMerchantSalt,
    payuMerchantId,
    payuEnv: payuEnv === "production" ? "production" : "test",
    payuWebhookSecret,
    payuSuccessUrl,
    payuFailureUrl,
    phonepeMerchantId,
    phonepeClientId,
    phonepeClientSecret,
    phonepeClientVersion,
    phonepeEnv: phonepeEnv === "production" ? "production" : "sandbox",
    phonepeWebhookSecret,
    phonepeSuccessUrl,
    phonepeFailureUrl,
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
    payuMerchantKey: settings.payuMerchantKey,
    payuMerchantSaltMasked: maskSecret(settings.payuMerchantSalt),
    payuMerchantSaltConfigured: Boolean(settings.payuMerchantSalt),
    payuMerchantId: settings.payuMerchantId,
    payuEnv: settings.payuEnv,
    payuWebhookSecretConfigured: Boolean(settings.payuWebhookSecret),
    payuSuccessUrl: settings.payuSuccessUrl,
    payuFailureUrl: settings.payuFailureUrl,
    phonepeMerchantId: settings.phonepeMerchantId,
    phonepeClientId: settings.phonepeClientId,
    phonepeClientSecretMasked: maskSecret(settings.phonepeClientSecret),
    phonepeClientSecretConfigured: Boolean(settings.phonepeClientSecret),
    phonepeClientVersion: settings.phonepeClientVersion,
    phonepeEnv: settings.phonepeEnv,
    phonepeWebhookSecretConfigured: Boolean(settings.phonepeWebhookSecret),
    phonepeSuccessUrl: settings.phonepeSuccessUrl,
    phonepeFailureUrl: settings.phonepeFailureUrl,
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
    payuMerchantKey:
      payload.payuMerchantKey !== undefined
        ? String(payload.payuMerchantKey || "").trim()
        : current.payuMerchantKey,
    payuMerchantSalt:
      payload.payuMerchantSalt !== undefined && String(payload.payuMerchantSalt || "").trim() !== ""
        ? String(payload.payuMerchantSalt).trim()
        : current.payuMerchantSalt,
    payuMerchantId:
      payload.payuMerchantId !== undefined
        ? String(payload.payuMerchantId || "").trim()
        : current.payuMerchantId,
    payuEnv:
      String(payload.payuEnv ?? current.payuEnv).toLowerCase() === "production" ? "production" : "test",
    payuWebhookSecret:
      payload.payuWebhookSecret !== undefined && String(payload.payuWebhookSecret || "").trim() !== ""
        ? String(payload.payuWebhookSecret).trim()
        : current.payuWebhookSecret,
    payuSuccessUrl:
      payload.payuSuccessUrl !== undefined
        ? String(payload.payuSuccessUrl || "").trim()
        : current.payuSuccessUrl,
    payuFailureUrl:
      payload.payuFailureUrl !== undefined
        ? String(payload.payuFailureUrl || "").trim()
        : current.payuFailureUrl,
    phonepeMerchantId:
      payload.phonepeMerchantId !== undefined
        ? String(payload.phonepeMerchantId || "").trim()
        : current.phonepeMerchantId,
    phonepeClientId:
      payload.phonepeClientId !== undefined
        ? String(payload.phonepeClientId || "").trim()
        : current.phonepeClientId,
    phonepeClientSecret:
      payload.phonepeClientSecret !== undefined && String(payload.phonepeClientSecret || "").trim() !== ""
        ? String(payload.phonepeClientSecret).trim()
        : current.phonepeClientSecret,
    phonepeClientVersion:
      payload.phonepeClientVersion !== undefined
        ? String(payload.phonepeClientVersion || "1").trim()
        : current.phonepeClientVersion,
    phonepeEnv:
      String(payload.phonepeEnv ?? current.phonepeEnv).toLowerCase() === "production" ? "production" : "sandbox",
    phonepeWebhookSecret:
      payload.phonepeWebhookSecret !== undefined && String(payload.phonepeWebhookSecret || "").trim() !== ""
        ? String(payload.phonepeWebhookSecret).trim()
        : current.phonepeWebhookSecret,
    phonepeSuccessUrl:
      payload.phonepeSuccessUrl !== undefined
        ? String(payload.phonepeSuccessUrl || "").trim()
        : current.phonepeSuccessUrl,
    phonepeFailureUrl:
      payload.phonepeFailureUrl !== undefined
        ? String(payload.phonepeFailureUrl || "").trim()
        : current.phonepeFailureUrl,
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
         googlePlayNotes = :googlePlayNotes,
         payuMerchantKey = :payuMerchantKey,
         payuMerchantSalt = :payuMerchantSalt,
         payuMerchantId = :payuMerchantId,
         payuEnv = :payuEnv,
         payuWebhookSecret = :payuWebhookSecret,
         payuSuccessUrl = :payuSuccessUrl,
         payuFailureUrl = :payuFailureUrl,
         phonepeMerchantId = :phonepeMerchantId,
         phonepeClientId = :phonepeClientId,
         phonepeClientSecret = :phonepeClientSecret,
         phonepeClientVersion = :phonepeClientVersion,
         phonepeEnv = :phonepeEnv,
         phonepeWebhookSecret = :phonepeWebhookSecret,
         phonepeSuccessUrl = :phonepeSuccessUrl,
         phonepeFailureUrl = :phonepeFailureUrl
     WHERE id = 1`,
    {
      replacements: next,
    }
  );

  return getAdminPaymentSettingsView();
};
