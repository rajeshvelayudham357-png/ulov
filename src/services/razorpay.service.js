import axios from "axios";
import crypto from "crypto";

import { getPaymentSettings } from "./paymentSettings.service.js";

const getRazorpayConfig = async () => {
  const settings = await getPaymentSettings();
  const keyId = settings.razorpayKeyId;
  const keySecret = settings.razorpayKeySecret;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }

  return {
    keyId,
    keySecret,
    webhookSecret: settings.razorpayWebhookSecret || "",
    env: settings.razorpayEnv,
    baseUrl: "https://api.razorpay.com/v1",
  };
};

const razorpayAuthHeader = (keyId, keySecret) => {
  const token = Buffer.from(`${keyId}:${keySecret}`).toString(
    "base64"
  );

  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
  };
};

export const createRazorpayOrder = async ({
  receipt,
  amount,
  notes = {},
}) => {
  const { keyId, keySecret, baseUrl } =
    await getRazorpayConfig();

  const amountPaise = Math.round(Number(amount) * 100);

  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    throw new Error("Invalid Razorpay amount");
  }

  const response = await axios.post(
    `${baseUrl}/orders`,
    {
      amount: amountPaise,
      currency: "INR",
      receipt: String(receipt).slice(0, 40),
      notes,
    },
    {
      headers: razorpayAuthHeader(keyId, keySecret),
    }
  );

  return response.data;
};

export const fetchRazorpayOrder = async (razorpayOrderId) => {
  const { keyId, keySecret, baseUrl } =
    await getRazorpayConfig();

  const response = await axios.get(
    `${baseUrl}/orders/${razorpayOrderId}`,
    {
      headers: razorpayAuthHeader(keyId, keySecret),
    }
  );

  return response.data;
};

export const fetchRazorpayPayment = async (paymentId) => {
  const { keyId, keySecret, baseUrl } =
    await getRazorpayConfig();

  const response = await axios.get(
    `${baseUrl}/payments/${paymentId}`,
    {
      headers: razorpayAuthHeader(keyId, keySecret),
    }
  );

  return response.data;
};

export const verifyRazorpayPaymentSignature = async ({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  const { keySecret } = await getRazorpayConfig();

  const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(payload)
    .digest("hex");

  return expected === String(razorpaySignature || "");
};

export const verifyRazorpayWebhookSignature = async ({
  rawBody,
  signature,
}) => {
  const { webhookSecret } = await getRazorpayConfig();

  if (!webhookSecret) {
    return true;
  }

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  return expected === String(signature || "");
};

export const getRazorpayCheckoutKeyId = async () => {
  const { keyId } = await getRazorpayConfig();
  return keyId;
};
