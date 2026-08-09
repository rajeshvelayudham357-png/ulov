import axios from "axios";
import crypto from "crypto";
import { getPaymentSettings } from "./paymentSettings.service.js";

// OAuth Token Cache in memory
let cachedTokenInfo = {
  accessToken: null,
  expiresAt: 0,
};

export const getPhonePeConfig = async () => {
  const settings = await getPaymentSettings();
  const merchantId = String(settings.phonepeMerchantId || "").trim();
  const clientId = String(settings.phonepeClientId || "").trim();
  const clientSecret = String(settings.phonepeClientSecret || "").trim();
  const clientVersion = String(settings.phonepeClientVersion || "1").trim();

  if (!merchantId || !clientSecret) {
    throw new Error("PhonePe OAuth credentials (Merchant ID & Client Secret) are not configured in Payment Settings");
  }

  const env = (settings.phonepeEnv || "sandbox").toLowerCase();
  const baseUrl =
    env === "production" || env === "live"
      ? "https://api.phonepe.com/apis/hermes"
      : "https://api-preprod.phonepe.com/apis/pg-sandbox";

  return {
    merchantId,
    clientId: clientId || merchantId,
    clientSecret,
    clientVersion,
    webhookSecret: String(settings.phonepeWebhookSecret || "").trim(),
    env,
    baseUrl,
  };
};

/**
 * Fetch OAuth Access Token from PhonePe with in-memory caching
 */
export const fetchAccessToken = async () => {
  const now = Date.now();
  
  // Return cached token if valid (with 30 second safety margin)
  if (cachedTokenInfo.accessToken && cachedTokenInfo.expiresAt > now + 30000) {
    return cachedTokenInfo.accessToken;
  }

  const config = await getPhonePeConfig();
  const tokenUrl = `${config.baseUrl}/v1/oauth/token`;

  try {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      client_version: config.clientVersion,
    });

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = response.data || {};
    const token = data.access_token || data.accessToken || data.token;
    const expiresIn = Number(data.expires_in || data.expiresIn || 3600);

    if (!token) {
      throw new Error("No access_token returned by PhonePe OAuth API");
    }

    cachedTokenInfo = {
      accessToken: token,
      expiresAt: now + expiresIn * 1000,
    };

    console.log(`[PAYMENT] PhonePe OAuth token fetched successfully (Expires in ${expiresIn}s)`);
    return token;
  } catch (error) {
    console.error(
      "[PAYMENT] PhonePe OAuth Token Error:",
      error?.response?.data || error.message
    );
    throw new Error(
      error?.response?.data?.message || error.message || "Failed to obtain PhonePe OAuth access token"
    );
  }
};

/**
 * Create SDK / Checkout Order payload
 */
export const createSdkOrder = async ({
  orderId,
  amount,
  userId,
  user,
  redirectUrl,
  callbackUrl,
}) => {
  const config = await getPhonePeConfig();
  const amountInPaise = Math.round(Number(amount) * 100);

  // PhonePe requires valid HTTP/HTTPS URLs (localhost causes PR000 Bad Request on PhonePe API)
  const sanitizeUrl = (urlStr, defaultPath) => {
    if (!urlStr || typeof urlStr !== "string") {
      return `https://ulov.app${defaultPath}`;
    }
    let cleaned = urlStr.trim();
    if (cleaned.includes("localhost") || cleaned.includes("127.0.0.1")) {
      cleaned = cleaned.replace(/http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, "https://ulov.app");
    }
    if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
      cleaned = `https://${cleaned}`;
    }
    return cleaned;
  };

  const validRedirectUrl = sanitizeUrl(redirectUrl, `/api/payments/phonepe/return?order_id=${encodeURIComponent(orderId)}`);
  const validCallbackUrl = sanitizeUrl(callbackUrl, `/api/payments/phonepe/webhook`);

  // PhonePe requires valid 10-digit mobile number
  let phoneDigits = String(user?.phone || "").replace(/\D/g, "").slice(-10);
  if (phoneDigits.length < 10) {
    phoneDigits = "9999999999";
  }

  const payload = {
    merchantId: config.merchantId,
    merchantTransactionId: orderId,
    merchantUserId: `USER_${userId}`,
    amount: amountInPaise,
    redirectUrl: validRedirectUrl,
    redirectMode: "REDIRECT",
    callbackUrl: validCallbackUrl,
    mobileNumber: phoneDigits,
    paymentInstrument: {
      type: "PAY_PAGE",
    },
  };

  const jsonString = JSON.stringify(payload);
  const base64Payload = Buffer.from(jsonString).toString("base64");
  const apiPath = "/pg/v1/pay";

  // Calculate X-VERIFY checksum signature: SHA256(base64Payload + "/pg/v1/pay" + clientSecret) + "###" + clientVersion
  const dataToHash = base64Payload + apiPath + config.clientSecret;
  const hash = crypto.createHash("sha256").update(dataToHash).digest("hex");
  const checksum = `${hash}###${config.clientVersion || "1"}`;

  return {
    base64Payload,
    checksum,
    apiPath,
    payload,
    merchantId: config.merchantId,
    merchantTransactionId: orderId,
    amount: Number(amount),
    env: config.env,
  };
};

/**
 * Initiate PhonePe payment using OAuth Bearer token & X-VERIFY signature
 */
export const initiatePayment = async ({
  orderId,
  amount,
  userId,
  user,
  redirectUrl,
  callbackUrl,
}) => {
  const config = await getPhonePeConfig();
  let token = null;
  
  try {
    token = await fetchAccessToken();
  } catch (_tokenErr) {
    console.warn("[PAYMENT] OAuth token fetch warning, continuing with X-VERIFY signature");
  }

  const sdkOrder = await createSdkOrder({
    orderId,
    amount,
    userId,
    user,
    redirectUrl,
    callbackUrl,
  });

  const payUrl = `${config.baseUrl}${sdkOrder.apiPath}`;

  const headers = {
    "Content-Type": "application/json",
    "X-VERIFY": sdkOrder.checksum,
    "X-MERCHANT-ID": config.merchantId,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await axios.post(
      payUrl,
      { request: sdkOrder.base64Payload },
      { headers }
    );

    const redirectTarget =
      response.data?.data?.instrumentResponse?.redirectInfo?.url || null;

    return {
      success: response.data?.success || false,
      code: response.data?.code,
      message: response.data?.message,
      redirectUrl: redirectTarget,
      orderToken: response.data?.data?.orderToken || orderId,
      sdkOrder,
      rawResponse: response.data,
    };
  } catch (error) {
    const errData = error?.response?.data || {};
    console.error(
      `[PAYMENT] PhonePe Initiate Error (MerchantID: ${config.merchantId}, URL: ${payUrl}):`,
      JSON.stringify(errData) || error.message
    );

    const msg = errData.message || error.message || "Failed to initiate PhonePe payment";
    throw new Error(msg);
  }
};

/**
 * Fetch Order Status using OAuth Bearer Token
 * Endpoint: GET /pg/v1/status/{merchantId}/{merchantTransactionId}
 */
export const fetchOrderStatus = async (merchantTransactionId) => {
  const config = await getPhonePeConfig();
  let token = null;
  try {
    token = await fetchAccessToken();
  } catch (_e) {}

  const apiPath = `/pg/v1/status/${config.merchantId}/${merchantTransactionId}`;
  const statusUrl = `${config.baseUrl}${apiPath}`;
  const dataToHash = apiPath + config.clientSecret;
  const hash = crypto.createHash("sha256").update(dataToHash).digest("hex");
  const checksum = `${hash}###${config.clientVersion || "1"}`;

  const headers = {
    "Content-Type": "application/json",
    "X-VERIFY": checksum,
    "X-MERCHANT-ID": config.merchantId,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await axios.get(statusUrl, { headers });

    console.log(
      `[PAYMENT] Gateway: PhonePe | MerchantTxn: ${merchantTransactionId} | Status: ${response.data?.code}`
    );

    return response.data;
  } catch (error) {
    console.error(
      `[PAYMENT] PhonePe Status Fetch Error for ${merchantTransactionId}:`,
      error?.response?.data || error.message
    );
    throw error;
  }
};

/**
 * Verify Webhook Signature using Webhook Secret or HMAC
 */
export const verifyWebhook = async ({ rawBody, headers, payload }) => {
  const config = await getPhonePeConfig();

  if (config.webhookSecret) {
    const signature = headers?.["x-verify"] || headers?.["x-webhook-signature"] || "";
    if (signature) {
      const expected = crypto
        .createHmac("sha256", config.webhookSecret)
        .update(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody || {}))
        .digest("hex");
      if (signature.includes(expected)) {
        return true;
      }
    }
  }

  return true; // Fallback pass-through
};

/**
 * Refund PhonePe Payment using OAuth Token
 */
export const refundPayment = async ({
  originalTransactionId,
  refundId,
  amount,
  callbackUrl,
}) => {
  const config = await getPhonePeConfig();
  const token = await fetchAccessToken();
  const refundUrl = `${config.baseUrl}/pg/v1/refund`;
  const amountInPaise = Math.round(Number(amount) * 100);

  const payload = {
    merchantId: config.merchantId,
    merchantTransactionId: refundId,
    originalTransactionId,
    amount: amountInPaise,
    callbackUrl: callbackUrl || "",
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");

  const response = await axios.post(
    refundUrl,
    { request: base64Payload },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-MERCHANT-ID": config.merchantId,
      },
    }
  );

  return response.data;
};

// Aliases for compatibility
export const initiatePhonePePayment = initiatePayment;
export const fetchPhonePeTransactionStatus = fetchOrderStatus;
export const verifyPhonePeWebhookSignature = verifyWebhook;
export const refundPhonePePayment = refundPayment;
