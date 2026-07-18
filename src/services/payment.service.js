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
  fetchRazorpayPayment,
  getRazorpayCheckoutKeyId,
  verifyRazorpayPaymentSignature,
} from "./razorpay.service.js";

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

  if (mappedStatus === "PAID") {
    let paymentMethod = "razorpay";
    let resolvedPaymentId = razorpayPaymentId;

    if (resolvedPaymentId) {
      try {
        const payment = await fetchRazorpayPayment(
          resolvedPaymentId
        );
        paymentMethod = payment.method || paymentMethod;
      } catch {
        // Keep default method if payment fetch fails.
      }
    }

    const result = await creditWalletForPayment(paymentOrder, {
      paymentMethod,
      razorpayPaymentId: resolvedPaymentId,
    });

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
