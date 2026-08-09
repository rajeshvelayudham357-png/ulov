import crypto from "crypto";
import axios from "axios";
import { getPaymentSettings } from "./paymentSettings.service.js";

const getPayUConfig = async () => {
  const settings = await getPaymentSettings();
  const key = settings.payuMerchantKey;
  const salt = settings.payuMerchantSalt;

  if (!key || !salt) {
    throw new Error("PayU credentials are not configured");
  }

  return {
    key,
    salt,
    merchantId: settings.payuMerchantId || "",
    webhookSecret: settings.payuWebhookSecret || "",
    env: settings.payuEnv || "test",
    baseUrl:
      settings.payuEnv === "production"
        ? "https://secure.payu.in"
        : "https://test.payu.in",
  };
};

/**
 * Generate PayU SHA-512 hash for checkout
 * Formula: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
 */
export const generatePayUHash = ({
  key,
  txnid,
  amount,
  productinfo,
  firstname,
  email,
  udf1 = "",
  udf2 = "",
  udf3 = "",
  udf4 = "",
  udf5 = "",
  salt,
}) => {
  const str = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
  return crypto.createHash("sha512").update(str).digest("hex");
};

/**
 * Verify PayU response hash (reverse hash)
 * Formula: sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 */
export const verifyPayUResponseHash = ({
  salt,
  status,
  udf5 = "",
  udf4 = "",
  udf3 = "",
  udf2 = "",
  udf1 = "",
  email,
  firstname,
  productinfo,
  amount,
  txnid,
  key,
  hash,
}) => {
  const str = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  const expected = crypto.createHash("sha512").update(str).digest("hex");
  return expected === String(hash || "");
};

/**
 * Get PayU checkout payload (key, hash, txnid etc) for embedding in the form
 */
export const getPayUCheckoutPayload = async ({
  txnid,
  amount,
  productinfo,
  firstname,
  email,
  phone,
  udf1 = "",
  successUrl,
  failureUrl,
}) => {
  const config = await getPayUConfig();
  const amountStr = Number(amount).toFixed(2);

  const hash = generatePayUHash({
    key: config.key,
    txnid,
    amount: amountStr,
    productinfo,
    firstname,
    email,
    udf1,
    salt: config.salt,
  });

  return {
    key: config.key,
    txnid,
    amount: amountStr,
    productinfo,
    firstname,
    email,
    phone,
    udf1,
    surl: successUrl,
    furl: failureUrl,
    hash,
    action: config.baseUrl + "/_payment",
    env: config.env,
  };
};

/**
 * Verify PayU payment response (called after user returns)
 */
export const verifyPayUPayment = async (responseParams) => {
  const config = await getPayUConfig();
  const {
    status,
    hash,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1 = "",
    udf2 = "",
    udf3 = "",
    udf4 = "",
    udf5 = "",
  } = responseParams;

  const valid = verifyPayUResponseHash({
    salt: config.salt,
    status,
    udf5,
    udf4,
    udf3,
    udf2,
    udf1,
    email,
    firstname,
    productinfo,
    amount,
    txnid,
    key: config.key,
    hash,
  });

  return {
    valid,
    status,
    txnid,
    payuPaymentId:
      responseParams.payuMoneyId || responseParams.mihpayid || txnid,
    amount: Number(amount) || 0,
  };
};

/**
 * Verify PayU webhook signature
 */
export const verifyPayUWebhookSignature = async ({ rawBody, signature }) => {
  const config = await getPayUConfig();
  if (!config.webhookSecret || !signature) {
    return true; // pass-through if not configured
  }
  const expected = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(rawBody)
    .digest("hex");
  return expected === String(signature || "");
};

/**
 * Fetch PayU transaction status from API
 */
export const fetchPayUTransactionStatus = async (txnid) => {
  const config = await getPayUConfig();
  const command = "verify_payment";
  const hashStr = `${config.key}|${command}|${txnid}|${config.salt}`;
  const hash = crypto.createHash("sha512").update(hashStr).digest("hex");

  const response = await axios.post(
    `${config.baseUrl}/merchant/postservice?form=2`,
    new URLSearchParams({
      key: config.key,
      command,
      var1: txnid,
      hash,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  return response.data;
};

export const getPayUMerchantKey = async () => {
  const config = await getPayUConfig();
  return config.key;
};
