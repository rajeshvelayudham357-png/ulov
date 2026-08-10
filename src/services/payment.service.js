import { QueryTypes } from "sequelize";

import { getGoldPackageById } from "../constants/goldPackages.js";
import { sequelize } from "../config/database.js";
import {
  PaymentOrder,
  User,
  Wallet,
  WalletTransaction,
} from "../models/index.js";
import {
  createCashfreeOrder,
  fetchCashfreeOrder,
  getCashfreeCheckoutMode,
  getPublicApiBaseUrl,
} from "./cashfree.service.js";
import { getPaymentSettings } from "./paymentSettings.service.js";
import {
  createRazorpayOrder,
  fetchRazorpayOrder,
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  getRazorpayCheckoutKeyId,
  verifyRazorpayPaymentSignature,
} from "./razorpay.service.js";
import {
  getPayUCheckoutPayload,
  verifyPayUPayment as verifyPayUPaymentSignature,
  fetchPayUTransactionStatus,
} from "./payu.service.js";
import {
  initiatePhonePePayment,
  fetchPhonePeTransactionStatus,
  verifyPhonePeWebhookSignature,
  refundPhonePePayment as executePhonePeRefund,
} from "./phonepe.service.js";

const PAID_STATUSES = new Set(["PAID", "SUCCESS", "CAPTURED"]);
const FAILED_STATUSES = new Set([
  "FAILED",
  "EXPIRED",
  "TERMINATED",
  "CANCELLED",
]);

let paymentOrderColumnsReady = false;

const columnExists = async (tableName, columnName) => {
  const rows = await sequelize.query(
    `SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME = :tableName
AND COLUMN_NAME = :columnName
LIMIT 1`,
    {
      replacements: { tableName, columnName },
      type: QueryTypes.SELECT,
    }
  );

  return rows.length > 0;
};

const ensureColumn = async (tableName, columnName, definition) => {
  if (await columnExists(tableName, columnName)) {
    return;
  }

  await sequelize.query(
    `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
  );
};

export const ensurePaymentOrderColumns = async () => {
  if (paymentOrderColumnsReady) {
    return;
  }

  await ensureColumn(
    "payment_orders",
    "gateway",
    "VARCHAR(30) NOT NULL DEFAULT 'cashfree'"
  );
  await ensureColumn(
    "payment_orders",
    "razorpayOrderId",
    "VARCHAR(120) NULL"
  );
  await ensureColumn(
    "payment_orders",
    "razorpayPaymentId",
    "VARCHAR(120) NULL"
  );
  await ensureColumn("payment_orders", "payuTxnId", "VARCHAR(120) NULL");
  await ensureColumn("payment_orders", "payuPaymentId", "VARCHAR(120) NULL");
  await ensureColumn("payment_orders", "payuStatus", "VARCHAR(50) NULL");
  await ensureColumn("payment_orders", "payuHash", "VARCHAR(255) NULL");

  await ensureColumn("payment_orders", "phonepeTransactionId", "VARCHAR(120) NULL");
  await ensureColumn("payment_orders", "phonepeMerchantTransactionId", "VARCHAR(120) NULL");
  await ensureColumn("payment_orders", "phonepeStatus", "VARCHAR(50) NULL");
  await ensureColumn("payment_orders", "phonepeChecksum", "VARCHAR(255) NULL");

  paymentOrderColumnsReady = true;
};

const buildOrderId = (userId) => `GOLD_${userId}_${Date.now()}`;

const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) {
    return "9999999999";
  }

  if (digits.length === 10) {
    return digits;
  }

  if (digits.length > 10) {
    return digits.slice(-10);
  }

  return digits.padStart(10, "9");
};

const createCashfreePaymentOrder = async ({
  userId,
  goldPackage,
  user,
  orderId,
}) => {
  const publicApiBaseUrl = getPublicApiBaseUrl();
  const returnUrl = `${publicApiBaseUrl}/api/payments/cashfree/return?order_id=${orderId}`;
  const notifyUrl = `${publicApiBaseUrl}/api/payments/cashfree/webhook`;

  const cashfreeOrder = await createCashfreeOrder({
    orderId,
    amount: goldPackage.price,
    customerDetails: {
      customer_id: String(userId),
      customer_name: user.name || user.username || "Ulov User",
      customer_email: user.email || `user${userId}@ulov.app`,
      customer_phone: normalizePhone(user.phone),
    },
    returnUrl,
    notifyUrl,
  });

  const paymentOrder = await PaymentOrder.create({
    orderId,
    userId,
    packageId: goldPackage.id,
    coins: goldPackage.coins,
    amount: goldPackage.price,
    gateway: "cashfree",
    paymentSessionId: cashfreeOrder.payment_session_id,
    status: "CREATED",
  });

  return {
    paymentOrder,
    gateway: "cashfree",
    cashfreeOrder,
    cashfreeMode: await getCashfreeCheckoutMode(),
  };
};

const createRazorpayPaymentOrder = async ({
  userId,
  goldPackage,
  user,
  orderId,
}) => {
  const razorpayOrder = await createRazorpayOrder({
    receipt: orderId,
    amount: goldPackage.price,
    notes: {
      orderId,
      userId: String(userId),
      packageId: String(goldPackage.id),
    },
  });

  const paymentOrder = await PaymentOrder.create({
    orderId,
    userId,
    packageId: goldPackage.id,
    coins: goldPackage.coins,
    amount: goldPackage.price,
    gateway: "razorpay",
    razorpayOrderId: razorpayOrder.id,
    paymentSessionId: razorpayOrder.id,
    status: "CREATED",
  });

  return {
    paymentOrder,
    gateway: "razorpay",
    razorpayOrder,
    razorpayKeyId: await getRazorpayCheckoutKeyId(),
    razorpayMode: (await getPaymentSettings()).razorpayEnv,
    customerContact: normalizePhone(user?.phone),
    customerEmail: user?.email || `user${userId}@ulov.app`,
    customerName: user?.name || user?.username || "Ulov User",
  };
};

const createPayUPaymentOrder = async ({ userId, goldPackage, user, orderId }) => {
  const settings = await getPaymentSettings();
  const publicApiBaseUrl = getPublicApiBaseUrl();
  const successUrl = settings.payuSuccessUrl ||
    `${publicApiBaseUrl}/api/payments/payu/return?order_id=${encodeURIComponent(orderId)}&status=success`;
  const failureUrl = settings.payuFailureUrl ||
    `${publicApiBaseUrl}/api/payments/payu/return?order_id=${encodeURIComponent(orderId)}&status=failure`;

  const payload = await getPayUCheckoutPayload({
    txnid: orderId,
    amount: goldPackage.price,
    productinfo: `${goldPackage.coins} Ulov Coins`,
    firstname: user.name || user.username || "UlovUser",
    email: user.email || `user${userId}@ulov.app`,
    phone: normalizePhone(user.phone),
    udf1: String(userId),
    successUrl,
    failureUrl,
  });

  const paymentOrder = await PaymentOrder.create({
    orderId,
    userId,
    packageId: goldPackage.id,
    coins: goldPackage.coins,
    amount: goldPackage.price,
    gateway: "payu",
    payuTxnId: orderId,
    payuHash: payload.hash,
    paymentSessionId: orderId,
    status: "CREATED",
  });

  return {
    paymentOrder,
    gateway: "payu",
    payuPayload: payload,
    customerContact: normalizePhone(user?.phone),
    customerEmail: user?.email || `user${userId}@ulov.app`,
    customerName: user?.name || user?.username || "Ulov User",
  };
};

export const createPaymentOrder = async ({ userId, packageId }) => {
  await ensurePaymentOrderColumns();

  const goldPackage = getGoldPackageById(packageId);

  if (!goldPackage) {
    throw new Error("Invalid gold package");
  }

  const user = await User.findByPk(userId);

  if (!user) {
    throw new Error("User not found");
  }

  const settings = await getPaymentSettings();
  const orderId = buildOrderId(userId);

  if (settings.activeGateway === "razorpay") {
    return createRazorpayPaymentOrder({
      userId,
      goldPackage,
      user,
      orderId,
    });
  }

  if (settings.activeGateway === "payu") {
    return createPayUPaymentOrder({ userId, goldPackage, user, orderId });
  }

  if (settings.activeGateway === "phonepe") {
    return createPhonePePaymentOrder({ userId, goldPackage, user, orderId });
  }

  return createCashfreePaymentOrder({
    userId,
    goldPackage,
    user,
    orderId,
  });
};

export const creditWalletForPayment = async (
  paymentOrder,
  {
    paymentMethod = null,
    cashfreePaymentId = null,
    razorpayPaymentId = null,
    payuPaymentId = null,
    phonepeTransactionId = null,
  } = {}
) => {
  if (paymentOrder.status === "PAID") {
    const wallet = await Wallet.findOne({
      where: { userId: paymentOrder.userId },
    });

    return {
      alreadyPaid: true,
      wallet,
      paymentOrder,
    };
  }

  return sequelize.transaction(async (transaction) => {
    const lockedOrder = await PaymentOrder.findOne({
      where: { id: paymentOrder.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!lockedOrder) {
      throw new Error("Payment order not found");
    }

    if (lockedOrder.status === "PAID") {
      const wallet = await Wallet.findOne({
        where: { userId: lockedOrder.userId },
        transaction,
      });

      return {
        alreadyPaid: true,
        wallet,
        paymentOrder: lockedOrder,
      };
    }

    let wallet = await Wallet.findOne({
      where: { userId: lockedOrder.userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!wallet) {
      wallet = await Wallet.create(
        {
          userId: lockedOrder.userId,
          balance: 0,
        },
        { transaction }
      );
    }

    wallet.balance =
      Number(wallet.balance) + Number(lockedOrder.coins);

    await wallet.save({ transaction });

    await WalletTransaction.create(
      {
        userId: lockedOrder.userId,
        type: "credit",
        amount: lockedOrder.coins,
        description: `Gold Recharge (Order ${lockedOrder.orderId})`,
      },
      { transaction }
    );

    lockedOrder.status = "PAID";
    lockedOrder.paymentMethod = paymentMethod;

    if (cashfreePaymentId) {
      lockedOrder.cashfreePaymentId = cashfreePaymentId;
    }

    if (razorpayPaymentId) {
      lockedOrder.razorpayPaymentId = razorpayPaymentId;
    }

    if (payuPaymentId) {
      lockedOrder.payuPaymentId = payuPaymentId;
      lockedOrder.payuStatus = "PAID";
    }

    if (phonepeTransactionId) {
      lockedOrder.phonepeTransactionId = phonepeTransactionId;
      lockedOrder.phonepeStatus = "PAID";
    }

    await lockedOrder.save({ transaction });

    return {
      alreadyPaid: false,
      wallet,
      paymentOrder: lockedOrder,
    };
  });
};

const mapCashfreeStatus = (orderStatus) => {
  const normalized = String(orderStatus || "").toUpperCase();

  if (PAID_STATUSES.has(normalized)) {
    return "PAID";
  }

  if (FAILED_STATUSES.has(normalized)) {
    return "FAILED";
  }

  return "CREATED";
};

const mapRazorpayStatus = (orderStatus) => {
  const normalized = String(orderStatus || "").toLowerCase();

  if (normalized === "paid") {
    return "PAID";
  }

  if (
    normalized === "attempted" ||
    normalized === "created"
  ) {
    return "CREATED";
  }

  return "FAILED";
};

const RAZORPAY_SUCCESS_PAYMENT_STATUSES = new Set([
  "captured",
  "authorized",
]);

const isSuccessfulRazorpayPayment = (
  payment,
  expectedAmountRupees
) => {
  if (!payment?.id) {
    return false;
  }

  const status = String(payment.status || "").toLowerCase();

  if (!RAZORPAY_SUCCESS_PAYMENT_STATUSES.has(status)) {
    return false;
  }

  const expectedPaise = Math.round(
    Number(expectedAmountRupees) * 100
  );
  const paidPaise = Number(payment.amount);

  return (
    Number.isFinite(expectedPaise) &&
    expectedPaise > 0 &&
    paidPaise >= expectedPaise
  );
};

const resolveCapturedRazorpayPayment = async ({
  paymentOrder,
  razorpayPaymentId = null,
}) => {
  if (razorpayPaymentId) {
    try {
      const payment = await fetchRazorpayPayment(
        razorpayPaymentId
      );

      if (
        isSuccessfulRazorpayPayment(
          payment,
          paymentOrder.amount
        )
      ) {
        return payment;
      }
    } catch (error) {
      console.log(
        "[RAZORPAY] fetch payment failed:",
        error.message
      );
    }
  }

  try {
    const payments = await fetchRazorpayOrderPayments(
      paymentOrder.razorpayOrderId
    );

    return (
      payments.find((payment) =>
        isSuccessfulRazorpayPayment(
          payment,
          paymentOrder.amount
        )
      ) || null
    );
  } catch (error) {
    console.log(
      "[RAZORPAY] fetch order payments failed:",
      error.message
    );

    return null;
  }
};

export const syncPaymentOrderFromCashfree = async (orderId) => {
  await ensurePaymentOrderColumns();

  const paymentOrder = await PaymentOrder.findOne({
    where: { orderId },
  });

  if (!paymentOrder) {
    throw new Error("Payment order not found");
  }

  const cashfreeOrder = await fetchCashfreeOrder(orderId);
  const mappedStatus = mapCashfreeStatus(cashfreeOrder.order_status);

  if (mappedStatus === "PAID") {
    const result = await creditWalletForPayment(paymentOrder, {
      paymentMethod: cashfreeOrder.payment_method || "cashfree",
      cashfreePaymentId:
        cashfreeOrder.cf_payment_id ||
        cashfreeOrder.payment_id ||
        null,
    });

    return {
      paymentOrder: result.paymentOrder,
      wallet: result.wallet,
      cashfreeOrder,
      credited: !result.alreadyPaid,
    };
  }

  if (mappedStatus === "FAILED" && paymentOrder.status !== "PAID") {
    paymentOrder.status = "FAILED";
    paymentOrder.failureReason =
      cashfreeOrder.order_note || cashfreeOrder.order_status;
    await paymentOrder.save();
  }

  return {
    paymentOrder,
    wallet: await Wallet.findOne({
      where: { userId: paymentOrder.userId },
    }),
    cashfreeOrder,
    credited: false,
  };
};

export const syncPaymentOrderFromRazorpay = async (
  orderId,
  {
    razorpayPaymentId = null,
    razorpaySignature = null,
  } = {}
) => {
  await ensurePaymentOrderColumns();

  const paymentOrder = await PaymentOrder.findOne({
    where: { orderId },
  });

  if (!paymentOrder) {
    throw new Error("Payment order not found");
  }

  if (paymentOrder.status === "PAID") {
    return {
      paymentOrder,
      wallet: await Wallet.findOne({
        where: { userId: paymentOrder.userId },
      }),
      credited: false,
    };
  }

  if (!paymentOrder.razorpayOrderId) {
    throw new Error("Razorpay order id missing on payment order");
  }

  if (razorpayPaymentId && razorpaySignature) {
    const valid = await verifyRazorpayPaymentSignature({
      razorpayOrderId: paymentOrder.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    if (!valid) {
      throw new Error("Invalid Razorpay payment signature");
    }
  }

  const razorpayOrder = await fetchRazorpayOrder(
    paymentOrder.razorpayOrderId
  );
  const mappedStatus = mapRazorpayStatus(razorpayOrder.status);

  const capturedPayment = await resolveCapturedRazorpayPayment({
    paymentOrder,
    razorpayPaymentId,
  });

  const shouldCredit =
    mappedStatus === "PAID" || Boolean(capturedPayment);

  if (shouldCredit) {
    const resolvedPaymentId =
      capturedPayment?.id || razorpayPaymentId || null;
    const paymentMethod =
      capturedPayment?.method || "razorpay";

    const result = await creditWalletForPayment(paymentOrder, {
      paymentMethod,
      razorpayPaymentId: resolvedPaymentId,
    });

    console.log(
      `[PAYMENT] Razorpay credited | Order: ${orderId} | Payment: ${resolvedPaymentId || "n/a"} | Gateway order: ${razorpayOrder.status}`
    );

    return {
      paymentOrder: result.paymentOrder,
      wallet: result.wallet,
      razorpayOrder,
      credited: !result.alreadyPaid,
    };
  }

  if (mappedStatus === "FAILED" && paymentOrder.status !== "PAID") {
    paymentOrder.status = "FAILED";
    paymentOrder.failureReason = razorpayOrder.status;
    await paymentOrder.save();
  }

  return {
    paymentOrder,
    wallet: await Wallet.findOne({
      where: { userId: paymentOrder.userId },
    }),
    razorpayOrder,
    credited: false,
  };
};

export const syncPaymentOrderFromPayU = async (orderId, responseParams = {}) => {
  await ensurePaymentOrderColumns();

  const paymentOrder = await PaymentOrder.findOne({ where: { orderId } });
  if (!paymentOrder) throw new Error("Payment order not found");

  // If we have response params, verify the hash
  if (responseParams.hash && responseParams.status) {
    const verification = await verifyPayUPaymentSignature(responseParams);
    if (!verification.valid) {
      throw new Error("Invalid PayU payment hash");
    }
    const status = String(responseParams.status || "").toLowerCase();
    if (status === "success" || status === "captured") {
      const result = await creditWalletForPayment(paymentOrder, {
        paymentMethod: "payu",
        payuPaymentId: verification.payuPaymentId,
      });
      return {
        paymentOrder: result.paymentOrder,
        wallet: result.wallet,
        payuStatus: "PAID",
        credited: !result.alreadyPaid,
      };
    }
  }

  // Fallback: query PayU API
  try {
    const apiStatus = await fetchPayUTransactionStatus(orderId);
    const txnDetails = apiStatus?.transaction_details?.[orderId];
    const txnStatus = String(txnDetails?.status || "").toLowerCase();
    if (txnStatus === "success" || txnStatus === "captured") {
      const result = await creditWalletForPayment(paymentOrder, {
        paymentMethod: "payu",
        payuPaymentId: txnDetails?.mihpayid || orderId,
      });
      return {
        paymentOrder: result.paymentOrder,
        wallet: result.wallet,
        payuStatus: "PAID",
        credited: !result.alreadyPaid,
      };
    }
  } catch (_err) {
    // API query failed, return current state
  }

  return {
    paymentOrder,
    wallet: await Wallet.findOne({ where: { userId: paymentOrder.userId } }),
    payuStatus: paymentOrder.status,
    credited: false,
  };
};

export const syncPaymentOrder = async (
  orderId,
  options = {}
) => {
  await ensurePaymentOrderColumns();

  const paymentOrder = await PaymentOrder.findOne({
    where: { orderId },
  });

  if (!paymentOrder) {
    throw new Error("Payment order not found");
  }

  if (paymentOrder.gateway === "razorpay") {
    return syncPaymentOrderFromRazorpay(orderId, options);
  }

  if (paymentOrder.gateway === "payu") {
    return syncPaymentOrderFromPayU(orderId, options);
  }

  if (paymentOrder.gateway === "phonepe") {
    return syncPaymentOrderFromPhonePe(orderId, options);
  }

  return syncPaymentOrderFromCashfree(orderId);
};

export const handleCashfreeWebhook = async (payload) => {
  const orderId =
    payload?.data?.order?.order_id ||
    payload?.order_id ||
    payload?.data?.order_id;

  if (!orderId) {
    throw new Error("Webhook order id missing");
  }

  return syncPaymentOrderFromCashfree(orderId);
};

export const handleRazorpayWebhook = async (payload) => {
  await ensurePaymentOrderColumns();

  const paymentEntity =
    payload?.payload?.payment?.entity ||
    payload?.payload?.order?.entity;

  const razorpayOrderId =
    paymentEntity?.order_id || paymentEntity?.id;

  if (!razorpayOrderId) {
    throw new Error("Webhook razorpay order id missing");
  }

  const paymentOrder = await PaymentOrder.findOne({
    where: { razorpayOrderId },
  });

  if (!paymentOrder) {
    throw new Error("Payment order not found for webhook");
  }

  return syncPaymentOrderFromRazorpay(paymentOrder.orderId, {
    razorpayPaymentId:
      payload?.payload?.payment?.entity?.id || null,
  });
};

export const handlePayUWebhook = async (payload) => {
  const txnid = payload?.txnid || payload?.mihpayid;
  if (!txnid) throw new Error("PayU webhook: txnid missing");

  const paymentOrder = await PaymentOrder.findOne({ where: { orderId: txnid } });
  if (!paymentOrder) throw new Error("Payment order not found for PayU webhook");

  return syncPaymentOrderFromPayU(txnid, payload);
};

export const createPhonePePaymentOrder = async ({ userId, goldPackage, user, orderId }) => {
  const settings = await getPaymentSettings();
  const publicApiBaseUrl = getPublicApiBaseUrl();
  const redirectUrl = settings.phonepeSuccessUrl ||
    `${publicApiBaseUrl}/api/payments/phonepe/return?order_id=${encodeURIComponent(orderId)}`;
  const callbackUrl = `${publicApiBaseUrl}/api/payments/phonepe/webhook`;

  const phonepeResult = await initiatePhonePePayment({
    orderId,
    amount: goldPackage.price,
    redirectUrl,
    callbackUrl,
  });

  const paymentOrder = await PaymentOrder.create({
    orderId,
    userId,
    packageId: goldPackage.id,
    coins: goldPackage.coins,
    amount: goldPackage.price,
    gateway: "phonepe",
    phonepeMerchantTransactionId: orderId,
    phonepeMerchantOrderId: phonepeResult.phonepeOrderId || null,
    phonepeRedirectUrl: phonepeResult.redirectUrl || null,
    phonepeOrderToken: phonepeResult.orderToken || null,
    paymentSessionId: orderId,
    status: "CREATED",
  });

  console.log(
    `[PAYMENT] Gateway: PhonePe | Order: ${orderId} | MerchantTxn: ${orderId} | Amount: ${goldPackage.price} | Status: CREATED`
  );

  return {
    paymentOrder,
    gateway: "phonepe",
    phonepeRedirectUrl: phonepeResult.redirectUrl,
    phonepePayload: phonepeResult.rawResponse,
    phonepeOrderId: phonepeResult.phonepeOrderId,
    customerContact: normalizePhone(user?.phone),
    customerEmail: user?.email || `user${userId}@ulov.app`,
    customerName: user?.name || user?.username || "Ulov User",
  };
};

export const syncPaymentOrderFromPhonePe = async (orderId) => {
  await ensurePaymentOrderColumns();

  const paymentOrder = await PaymentOrder.findOne({ where: { orderId } });
  if (!paymentOrder) throw new Error("Payment order not found");

  if (paymentOrder.status === "PAID") {
    return {
      paymentOrder,
      wallet: await Wallet.findOne({ where: { userId: paymentOrder.userId } }),
      phonepeStatus: "PAID",
      credited: false,
    };
  }

  try {
    const statusData = await fetchPhonePeTransactionStatus(orderId);
    const state = String(statusData?.state || "").toUpperCase();
    const legacyCode = String(statusData?.code || "").toUpperCase();
    const isPaid =
      state === "COMPLETED" || legacyCode === "PAYMENT_SUCCESS";

    if (isPaid) {
      const providerTxnId =
        statusData?.paymentDetails?.[0]?.transactionId ||
        statusData?.orderId ||
        orderId;
      const result = await creditWalletForPayment(paymentOrder, {
        paymentMethod:
          statusData?.paymentDetails?.[0]?.paymentMode || "phonepe",
        phonepeTransactionId: providerTxnId,
      });

      console.log(
        `[PAYMENT] Gateway: PhonePe | Order: ${orderId} | Status: PAID | Credited: ${!result.alreadyPaid}`
      );

      return {
        paymentOrder: result.paymentOrder,
        wallet: result.wallet,
        phonepeStatus: "PAID",
        credited: !result.alreadyPaid,
      };
    }

    if (state === "FAILED" || legacyCode === "PAYMENT_ERROR" || legacyCode === "PAYMENT_DECLINED") {
      paymentOrder.status = "FAILED";
      paymentOrder.failureReason =
        statusData?.message ||
        statusData?.errorCode ||
        state ||
        legacyCode;
      await paymentOrder.save();
    }
  } catch (error) {
    console.error(`[PAYMENT] Gateway: PhonePe | Order: ${orderId} | Status Sync Failed:`, error.message);
  }

  return {
    paymentOrder,
    wallet: await Wallet.findOne({ where: { userId: paymentOrder.userId } }),
    phonepeStatus: paymentOrder.status,
    credited: false,
  };
};

export const handlePhonePeWebhook = async (payload, xVerifyHeader) => {
  const base64Response = payload?.response;
  let decoded = {};
  
  if (base64Response) {
    try {
      const jsonStr = Buffer.from(base64Response, "base64").toString("utf-8");
      decoded = JSON.parse(jsonStr);
    } catch (_e) {
      decoded = payload;
    }
  } else {
    decoded = payload;
  }

  const merchantTransactionId =
    decoded?.merchantOrderId ||
    decoded?.data?.merchantTransactionId ||
    decoded?.merchantTransactionId ||
    payload?.merchantOrderId ||
    payload?.merchantTransactionId;
  if (!merchantTransactionId) throw new Error("PhonePe webhook: merchantTransactionId missing");

  const paymentOrder = await PaymentOrder.findOne({ where: { orderId: merchantTransactionId } });
  if (!paymentOrder) throw new Error("Payment order not found for PhonePe webhook");

  // Prevent duplicate wallet credits if already paid
  if (paymentOrder.status === "PAID") {
    console.log(`[PAYMENT] Gateway: PhonePe | Order: ${merchantTransactionId} | Webhook ignored (Already PAID)`);
    return { alreadyPaid: true, paymentOrder };
  }

  const valid = await verifyPhonePeWebhookSignature({ rawBody: payload, xVerifyHeader, payload: decoded });
  if (!valid) throw new Error("Invalid PhonePe webhook signature");

  return syncPaymentOrderFromPhonePe(merchantTransactionId);
};

export const refundPhonePePayment = async ({ orderId, amount }) => {
  await ensurePaymentOrderColumns();
  const paymentOrder = await PaymentOrder.findOne({ where: { orderId } });
  if (!paymentOrder) throw new Error("Payment order not found");

  const refundId = `REFUND_${orderId}_${Date.now()}`;
  const result = await executePhonePeRefund({
    originalTransactionId: paymentOrder.phonepeTransactionId || orderId,
    refundId,
    amount: amount || paymentOrder.amount,
  });

  return result;
};

export const getPaymentOrderForUser = async ({
  orderId,
  userId,
}) => {
  await ensurePaymentOrderColumns();

  const paymentOrder = await PaymentOrder.findOne({
    where: {
      orderId,
      userId,
    },
  });

  if (!paymentOrder) {
    throw new Error("Payment order not found");
  }

  return paymentOrder;
};

export const listRecentPaymentOrders = async (
  userId,
  limit = 10
) => {
  await ensurePaymentOrderColumns();

  return PaymentOrder.findAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
    limit,
  });
};
