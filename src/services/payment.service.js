import { Op } from "sequelize";

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
  getPublicApiBaseUrl,
} from "./cashfree.service.js";

const PAID_STATUSES = new Set([
  "PAID",
  "SUCCESS",
]);

const FAILED_STATUSES = new Set([
  "FAILED",
  "EXPIRED",
  "TERMINATED",
  "CANCELLED",
]);

const buildOrderId = (userId) =>
  `GOLD_${userId}_${Date.now()}`;

const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(
    /\D/g,
    ""
  );

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

export const createPaymentOrder = async ({
  userId,
  packageId,
}) => {
  const goldPackage = getGoldPackageById(packageId);

  if (!goldPackage) {
    throw new Error("Invalid gold package");
  }

  const user = await User.findByPk(userId);

  if (!user) {
    throw new Error("User not found");
  }

  const orderId = buildOrderId(userId);
  const publicApiBaseUrl = getPublicApiBaseUrl();
  const returnUrl = `${publicApiBaseUrl}/api/payments/cashfree/return?order_id=${orderId}`;
  const notifyUrl = `${publicApiBaseUrl}/api/payments/cashfree/webhook`;

  const cashfreeOrder = await createCashfreeOrder({
    orderId,
    amount: goldPackage.price,
    customerDetails: {
      customer_id: String(userId),
      customer_name:
        user.name ||
        user.username ||
        "Ulov User",
      customer_email:
        user.email ||
        `user${userId}@ulov.app`,
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
    paymentSessionId:
      cashfreeOrder.payment_session_id,
    status: "CREATED",
  });

  return {
    paymentOrder,
    cashfreeOrder,
  };
};

export const creditWalletForPayment = async (
  paymentOrder,
  {
    paymentMethod = null,
    cashfreePaymentId = null,
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
      Number(wallet.balance) +
      Number(lockedOrder.coins);

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
    lockedOrder.cashfreePaymentId = cashfreePaymentId;

    await lockedOrder.save({ transaction });

    return {
      alreadyPaid: false,
      wallet,
      paymentOrder: lockedOrder,
    };
  });
};

const mapCashfreeStatus = (orderStatus) => {
  const normalized = String(
    orderStatus || ""
  ).toUpperCase();

  if (PAID_STATUSES.has(normalized)) {
    return "PAID";
  }

  if (FAILED_STATUSES.has(normalized)) {
    return "FAILED";
  }

  return "CREATED";
};

export const syncPaymentOrderFromCashfree = async (
  orderId
) => {
  const paymentOrder = await PaymentOrder.findOne({
    where: { orderId },
  });

  if (!paymentOrder) {
    throw new Error("Payment order not found");
  }

  const cashfreeOrder = await fetchCashfreeOrder(
    orderId
  );

  const mappedStatus = mapCashfreeStatus(
    cashfreeOrder.order_status
  );

  if (mappedStatus === "PAID") {
    const result = await creditWalletForPayment(
      paymentOrder,
      {
        paymentMethod:
          cashfreeOrder.payment_method ||
          null,
        cashfreePaymentId:
          cashfreeOrder.cf_payment_id ||
          cashfreeOrder.payment_id ||
          null,
      }
    );

    return {
      paymentOrder: result.paymentOrder,
      wallet: result.wallet,
      cashfreeOrder,
      credited: !result.alreadyPaid,
    };
  }

  if (
    mappedStatus === "FAILED" &&
    paymentOrder.status !== "PAID"
  ) {
    paymentOrder.status = "FAILED";
    paymentOrder.failureReason =
      cashfreeOrder.order_note ||
      cashfreeOrder.order_status;
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

export const getPaymentOrderForUser = async ({
  orderId,
  userId,
}) => {
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
) =>
  PaymentOrder.findAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
    limit,
  });
