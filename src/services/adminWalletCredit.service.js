import { Op } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  GOLD_PACKAGES,
  getAllPurchasablePackages,
  resolveGoldPackageById,
} from "../constants/goldPackages.js";
import { User, Wallet, WalletTransaction, PaymentOrder } from "../models/index.js";
import { creditWalletForPayment } from "./payment.service.js";

const normalizePhone = (phone) =>
  String(phone || "")
    .trim()
    .replace(/\D/g, "");

const getDisplayName = (user) => {
  if (!user) {
    return "Unknown";
  }

  return (
    user.nickname ||
    (user.name && user.name !== "New User" ? user.name : null) ||
    user.username ||
    user.publicUserId ||
    user.phone ||
    `User ${user.id ?? ""}`.trim()
  );
};

export const getMaleWalletCreditPackages = async () => {
  const { bonus } = await getAllPurchasablePackages();
  return [...GOLD_PACKAGES, ...bonus];
};

export const lookupMaleUserForWalletCredit = async (phone) => {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    throw new Error("Phone number is required");
  }

  const user = await User.findOne({
    where: {
      [Op.or]: [{ phone: normalizedPhone }, { phone: `+91${normalizedPhone}` }],
      gender: { [Op.in]: ["Male", "male"] },
    },
    include: [
      {
        model: Wallet,
        as: "wallet",
        required: false,
        attributes: ["id", "balance"],
      },
    ],
  });

  if (!user) {
    return null;
  }

  const row = user.toJSON();

  return {
    id: row.id,
    displayName: getDisplayName(row),
    phone: row.phone || normalizedPhone,
    publicUserId: row.publicUserId || null,
    walletBalance: Number(row.wallet?.balance || 0),
  };
};

export const creditMaleUserWallet = async ({
  phone,
  userId,
  coins,
  amount,
  packageId,
  recordRecharge = false,
  gateway = "admin",
  razorpayOrderId = null,
  razorpayPaymentId = null,
  paymentMethod = null,
  note = null,
}) => {
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  let user = null;

  if (userId && Number.isFinite(Number(userId))) {
    user = await User.findByPk(Number(userId), {
      include: [{ model: Wallet, as: "wallet", required: false }],
    });
  } else if (normalizedPhone) {
    user = await User.findOne({
      where: {
        [Op.or]: [{ phone: normalizedPhone }, { phone: `+91${normalizedPhone}` }],
      },
      include: [{ model: Wallet, as: "wallet", required: false }],
    });
  }

  if (!user) {
    throw new Error("Male user not found for this phone number");
  }

  if (!["Male", "male"].includes(String(user.gender || ""))) {
    throw new Error("This account is not a male user");
  }

  let finalCoins = coins != null ? Number(coins) : null;
  let finalAmount = amount != null ? Number(amount) : null;
  let finalPackageId = packageId != null ? Number(packageId) : null;

  if (finalPackageId) {
    const goldPackage = await resolveGoldPackageById(finalPackageId);

    if (!goldPackage) {
      throw new Error("Invalid gold package selected");
    }

    finalCoins = goldPackage.coins;
    finalAmount = goldPackage.price;
  }

  if (!Number.isFinite(finalCoins) || finalCoins <= 0) {
    throw new Error("Coins must be greater than 0");
  }

  if (recordRecharge && (!Number.isFinite(finalAmount) || finalAmount < 0)) {
    throw new Error("Recharge amount is required when recording a payment order");
  }

  const description =
    String(note || "").trim() || "Manual admin credit";

  if (recordRecharge) {
    const orderId = `GOLD_${user.id}_${Date.now()}`;
    const resolvedGateway = String(gateway || "admin").trim() || "admin";
    const resolvedPaymentMethod =
      String(paymentMethod || "").trim() || "Admin Manual";

    const paymentOrder = await PaymentOrder.create({
      orderId,
      userId: user.id,
      packageId: finalPackageId,
      coins: finalCoins,
      amount: finalAmount ?? 0,
      gateway: resolvedGateway,
      razorpayOrderId: razorpayOrderId || null,
      razorpayPaymentId: razorpayPaymentId || null,
      paymentSessionId: razorpayOrderId || null,
      status: "CREATED",
      paymentMethod: resolvedPaymentMethod,
    });

    const creditResult = await creditWalletForPayment(paymentOrder, {
      paymentMethod: resolvedPaymentMethod,
      razorpayPaymentId: razorpayPaymentId || null,
    });

    return {
      mode: "recharge",
      user: {
        id: user.id,
        displayName: getDisplayName(user),
        phone: user.phone,
        publicUserId: user.publicUserId || null,
      },
      wallet: {
        balance: Number(creditResult.wallet?.balance || 0),
      },
      paymentOrder: {
        id: creditResult.paymentOrder?.id,
        orderId: creditResult.paymentOrder?.orderId,
        status: creditResult.paymentOrder?.status,
        coins: creditResult.paymentOrder?.coins,
        amount: creditResult.paymentOrder?.amount,
        gateway: creditResult.paymentOrder?.gateway,
        paymentMethod: creditResult.paymentOrder?.paymentMethod,
        razorpayOrderId: creditResult.paymentOrder?.razorpayOrderId,
        razorpayPaymentId: creditResult.paymentOrder?.razorpayPaymentId,
      },
      alreadyPaid: Boolean(creditResult.alreadyPaid),
      description,
    };
  }

  const result = await sequelize.transaction(async (transaction) => {
    let wallet = await Wallet.findOne({
      where: { userId: user.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!wallet) {
      wallet = await Wallet.create(
        {
          userId: user.id,
          balance: 0,
        },
        { transaction }
      );
    }

    wallet.balance = Number(wallet.balance) + finalCoins;
    await wallet.save({ transaction });

    const walletTransaction = await WalletTransaction.create(
      {
        userId: user.id,
        type: "credit",
        amount: finalCoins,
        description,
      },
      { transaction }
    );

    return { wallet, walletTransaction };
  });

  return {
    mode: "wallet",
    user: {
      id: user.id,
      displayName: getDisplayName(user),
      phone: user.phone,
      publicUserId: user.publicUserId || null,
    },
    wallet: {
      balance: Number(result.wallet.balance || 0),
    },
    transaction: {
      id: result.walletTransaction.id,
      type: result.walletTransaction.type,
      amount: result.walletTransaction.amount,
      description: result.walletTransaction.description,
    },
    paymentOrder: null,
    description,
  };
};
