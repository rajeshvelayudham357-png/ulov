import { Op } from "sequelize";

import { Earning, Withdraw } from "../models/index.js";
import { assertWithdrawAvailableNow } from "./withdrawSettings.service.js";
import { getReferralEarningsTotal } from "./referral.service.js";

const toAmount = (value) => Number(value || 0);

export const MIN_FEMALE_WITHDRAW_AMOUNT = 200;

export const getTotalEarnedAmount = async (userId) => {
  const [callEarnings, referralEarnings] = await Promise.all([
    Earning.sum("amount", { where: { userId } }),
    getReferralEarningsTotal(userId),
  ]);

  return toAmount(callEarnings) + toAmount(referralEarnings);
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

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

export const assertWithdrawRequestAllowed = async ({
  userId,
  amount,
}) => {
  await assertWithdrawAvailableNow();

  const requestAmount = toAmount(amount);

  if (requestAmount < MIN_FEMALE_WITHDRAW_AMOUNT) {
    throw badRequest(`Minimum withdraw ₹${MIN_FEMALE_WITHDRAW_AMOUNT}`);
  }

  const summary = await getFemaleWithdrawSummary(userId);

  if (requestAmount > summary.availableBalance) {
    throw badRequest(
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
