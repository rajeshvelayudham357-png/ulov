import axios from "axios";
import crypto from "crypto";
import { getPaymentSettings } from "./paymentSettings.service.js";

let cachedTokenInfo = {
  accessToken: null,
  expiresAt: 0,
  cacheKey: null,
};

const buildCacheKey = (config) =>
  `${config.env}:${config.clientId}:${config.clientVersion}`;

const formatPhonePeAuthError = (error, config) => {
  const errData = error?.response?.data || {};
  const errorCode = String(errData.errorCode || errData.code || "");
  const status = error?.response?.status;

  if (
    status === 404 &&
    (errorCode === "OIM007" || String(errData.code || "") === "CLIENT_NOT_FOUND") &&
    config.env === "production"
  ) {
    return (
      "PhonePe CLIENT_NOT_FOUND: your credentials are from PhonePe TEST MODE but Payment Settings Environment is Production. " +
      "Set Environment to Sandbox in Admin → Payment Settings, re-save Client Secret, and restart the backend."
    );
  }

  return (
    errData.message ||
    errData.code ||
    error.message ||
    "Failed to obtain PhonePe OAuth access token"
  );
};

const normalizeClientId = (clientId, merchantId) => {
  const id = String(clientId || "").trim();
  const merchant = String(merchantId || "").trim();

  if (!id) {
    return merchant;
  }

  if (id.includes("_")) {
    return id;
  }

  if (merchant && !id.startsWith(merchant)) {
    return `${merchant}_${id}`;
  }

  return id;
};

const sanitizeRedirectUrl = (urlStr, fallbackUrl) => {
  if (!urlStr || typeof urlStr !== "string") {
    return fallbackUrl;
  }

  let cleaned = urlStr.trim();

  if (cleaned.includes("localhost") || cleaned.includes("127.0.0.1")) {
    return fallbackUrl;
  }

  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    cleaned = `https://${cleaned}`;
  }

  return cleaned;
};

export const getPhonePeConfig = async () => {
  const settings = await getPaymentSettings();
  const merchantId = String(settings.phonepeMerchantId || "").trim();
  const clientId = normalizeClientId(settings.phonepeClientId, merchantId);
  const clientSecret = String(settings.phonepeClientSecret || "").trim();
  const clientVersion = String(settings.phonepeClientVersion || "1").trim();
  const env = String(settings.phonepeEnv || "sandbox").toLowerCase();
  const isProduction = env === "production" || env === "live";

  if (!merchantId || !clientSecret) {
    throw new Error(
      "PhonePe OAuth credentials (Merchant ID & Client Secret) are not configured in Payment Settings"
    );
  }

  if (!clientId) {
    throw new Error(
      "PhonePe Client ID is not configured. Use the full value from PhonePe dashboard (e.g. MERCHANTID_1234567890)"
    );
  }

  return {
    merchantId,
    clientId,
    clientSecret,
    clientVersion,
    webhookSecret: String(settings.phonepeWebhookSecret || "").trim(),
    env: isProduction ? "production" : "sandbox",
    tokenUrl: isProduction
      ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
      : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    apiBaseUrl: isProduction
      ? "https://api.phonepe.com/apis/pg"
      : "https://api-preprod.phonepe.com/apis/pg-sandbox",
  };
};

export const fetchAccessToken = async () => {
  const now = Date.now();
  const config = await getPhonePeConfig();
  const cacheKey = buildCacheKey(config);

  if (
    cachedTokenInfo.accessToken &&
    cachedTokenInfo.cacheKey === cacheKey &&
    cachedTokenInfo.expiresAt > now + 30000
  ) {
    return cachedTokenInfo.accessToken;
  }

  try {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      client_version: config.clientVersion,
    });

    console.log(
      `[PAYMENT] PhonePe OAuth request (${config.env}) → ${config.tokenUrl} | clientId=${config.clientId}`
    );

    const response = await axios.post(config.tokenUrl, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = response.data || {};
    const token = data.access_token || data.accessToken || data.token;

    if (!token) {
      throw new Error("No access_token returned by PhonePe OAuth API");
    }

    const expiresAtEpoch = Number(data.expires_at || 0);
    const expiresIn = Number(data.expires_in || data.expiresIn || 3600);
    const expiresAtMs =
      expiresAtEpoch > 0
        ? expiresAtEpoch * (expiresAtEpoch > 1_000_000_000_000 ? 1 : 1000)
        : now + expiresIn * 1000;

    cachedTokenInfo = {
      accessToken: token,
      expiresAt: expiresAtMs,
      cacheKey,
    };

    console.log(
      `[PAYMENT] PhonePe OAuth token fetched (${config.env}) for client ${config.clientId}`
    );

    return token;
  } catch (error) {
    console.error(
      "[PAYMENT] PhonePe OAuth Token Error:",
      error?.response?.status,
      error?.response?.data || error.message
    );

    throw new Error(formatPhonePeAuthError(error, config));
  }
};

const buildAuthHeader = (token) => `O-Bearer ${token}`;

export const initiatePayment = async ({
  orderId,
  amount,
  redirectUrl,
  callbackUrl,
}) => {
  const config = await getPhonePeConfig();
  const token = await fetchAccessToken();
  const amountInPaise = Math.round(Number(amount) * 100);

  if (amountInPaise < 100) {
    throw new Error("PhonePe minimum payment amount is ₹1");
  }

  const validRedirectUrl = sanitizeRedirectUrl(
    redirectUrl,
    `https://ulov.app/api/payments/phonepe/return?order_id=${encodeURIComponent(orderId)}`
  );

  const payUrl = `${config.apiBaseUrl}/checkout/v2/pay`;
  const requestBody = {
    merchantOrderId: orderId,
    amount: amountInPaise,
    expireAfter: 1200,
    paymentFlow: {
      type: "PG_CHECKOUT",
      message: "Ulov gold recharge",
      merchantUrls: {
        redirectUrl: validRedirectUrl,
      },
    },
    metaInfo: {
      udf1: orderId,
      udf2: callbackUrl ? "webhook-configured" : "webhook-default",
    },
  };

  try {
    const response = await axios.post(payUrl, requestBody, {
      headers: {
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(token),
        "X-MERCHANT-ID": config.merchantId,
      },
    });

    const data = response.data || {};
    const redirectTarget = data.redirectUrl || null;

    if (!redirectTarget) {
      throw new Error(
        data.message || "PhonePe did not return a redirect URL for checkout"
      );
    }

    return {
      success: true,
      redirectUrl: redirectTarget,
      orderToken: data.orderId || orderId,
      phonepeOrderId: data.orderId || null,
      state: data.state || "PENDING",
      rawResponse: data,
    };
  } catch (error) {
    const errData = error?.response?.data || {};
    console.error(
      `[PAYMENT] PhonePe Initiate Error (${config.env}, URL: ${payUrl}):`,
      error?.response?.status,
      JSON.stringify(errData) || error.message
    );

    throw new Error(
      errData.message ||
        errData.code ||
        error.message ||
        "Failed to initiate PhonePe payment"
    );
  }
};

export const fetchOrderStatus = async (merchantOrderId) => {
  const config = await getPhonePeConfig();
  const token = await fetchAccessToken();
  const statusUrl = `${config.apiBaseUrl}/checkout/v2/order/${encodeURIComponent(
    merchantOrderId
  )}/status?details=false`;

  try {
    const response = await axios.get(statusUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(token),
        "X-MERCHANT-ID": config.merchantId,
      },
    });

    console.log(
      `[PAYMENT] Gateway: PhonePe | Order: ${merchantOrderId} | State: ${response.data?.state}`
    );

    return response.data;
  } catch (error) {
    console.error(
      `[PAYMENT] PhonePe Status Fetch Error for ${merchantOrderId}:`,
      error?.response?.status,
      error?.response?.data || error.message
    );
    throw error;
  }
};

export const verifyWebhook = async ({ rawBody, headers }) => {
  const config = await getPhonePeConfig();

  if (!config.webhookSecret) {
    return true;
  }

  const signature =
    headers?.["x-verify"] ||
    headers?.["x-webhook-signature"] ||
    headers?.["authorization"] ||
    "";

  if (!signature) {
    return false;
  }

  const payload =
    typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody || {});

  const expected = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(payload)
    .digest("hex");

  return signature.includes(expected);
};

export const refundPayment = async ({
  originalTransactionId,
  refundId,
  amount,
  callbackUrl,
}) => {
  const config = await getPhonePeConfig();
  const token = await fetchAccessToken();
  const refundUrl = `${config.apiBaseUrl}/payments/v2/refund`;
  const amountInPaise = Math.round(Number(amount) * 100);

  const requestBody = {
    merchantRefundId: refundId,
    originalMerchantOrderId: originalTransactionId,
    amount: amountInPaise,
    callbackUrl: callbackUrl || "",
  };

  const response = await axios.post(refundUrl, requestBody, {
    headers: {
      "Content-Type": "application/json",
      Authorization: buildAuthHeader(token),
      "X-MERCHANT-ID": config.merchantId,
    },
  });

  return response.data;
};

export const initiatePhonePePayment = initiatePayment;
export const fetchPhonePeTransactionStatus = fetchOrderStatus;
export const verifyPhonePeWebhookSignature = verifyWebhook;
export const refundPhonePePayment = refundPayment;
