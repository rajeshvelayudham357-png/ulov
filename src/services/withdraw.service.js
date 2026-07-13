import { Op } from "sequelize";

import { Earning, Withdraw } from "../models/index.js";

const toAmount = (value) => Number(value || 0);

export const getTotalEarnedAmount = async (userId) => {
  const total = await Earning.sum("amount", {
    where: { userId },
  });

  return toAmount(total);
};

export const getApprovedWithdrawAmount = async (userId) => {
  const total = await Withdraw.sum("amount", {
    where: {
      userId,
      status: "approved",
    },
  });

  return toAmount(total);
};

export const getPendingWithdrawAmount = async (userId) => {
  const total = await Withdraw.sum("amount", {
    where: {
      userId,
      status: "pending",
    },
  });

  return toAmount(total);
};

export const getFemaleWithdrawSummary = async (userId) => {
  const [totalEarned, withdrawnAmount, pendingAmount] = await Promise.all([
    getTotalEarnedAmount(userId),
    getApprovedWithdrawAmount(userId),
    getPendingWithdrawAmount(userId),
  ]);

  const availableBalance = Math.max(
    0,
    totalEarned - withdrawnAmount - pendingAmount
  );

  return {
    totalEarned,
    withdrawnAmount,
    pendingAmount,
    availableBalance,
  };
};

export const assertWithdrawRequestAllowed = async ({
  userId,
  amount,
}) => {
  const requestAmount = toAmount(amount);

  if (requestAmount < 100) {
    throw new Error("Minimum withdraw ₹100");
  }

  const summary = await getFemaleWithdrawSummary(userId);

  if (requestAmount > summary.availableBalance) {
    throw new Error(
      `Insufficient balance. Available ₹${summary.availableBalance}`
    );
  }

  return summary;
};

export const formatWithdrawRecord = (record) => {
  const data = record.toJSON ? record.toJSON() : record;

  return {
    id: data.id,
    userId: data.userId,
    amount: toAmount(data.amount),
    upiId: data.upiId || "",
    accountName: data.accountName || "",
    accountNumber: data.accountNumber || "",
    ifsc: data.ifsc || "",
    payoutMethod: data.upiId ? "upi" : "bank",
    status: data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};
