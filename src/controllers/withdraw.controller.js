import { Kyc, Withdraw } from "../models/index.js";
import {
  assertWithdrawRequestAllowed,
  formatWithdrawRecord,
  getFemaleWithdrawSummary,
} from "../services/withdraw.service.js";

export const requestWithdraw = async (req, res) => {
  try {
    const {
      userId,
      amount,
      payoutMethod,
      upiId,
      accountName,
      accountNumber,
      ifsc,
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    await assertWithdrawRequestAllowed({
      userId,
      amount,
    });

    const kyc = await Kyc.findOne({
      where: { userId },
    });

    if (!kyc || kyc.status !== "approved") {
      return res.status(400).json({
        message: "Bank verification must be approved before withdrawal",
      });
    }

    const method =
      payoutMethod === "bank"
        ? "bank"
        : payoutMethod === "upi"
          ? "upi"
          : upiId
            ? "upi"
            : "bank";

    let payload = {
      userId,
      amount,
      status: "pending",
      upiId: null,
      accountName: null,
      accountNumber: null,
      ifsc: null,
    };

    if (method === "upi") {
      const resolvedUpiId = upiId || kyc.upiId;

      if (!resolvedUpiId) {
        return res.status(400).json({
          message: "UPI ID is required for UPI withdrawal",
        });
      }

      payload = {
        ...payload,
        upiId: resolvedUpiId,
        accountName: kyc.accountName,
        accountNumber: kyc.accountNumber,
        ifsc: kyc.ifsc,
      };
    } else {
      const resolvedAccountName = accountName || kyc.accountName;
      const resolvedAccountNumber = accountNumber || kyc.accountNumber;
      const resolvedIfsc = ifsc || kyc.ifsc;

      if (!resolvedAccountName || !resolvedAccountNumber || !resolvedIfsc) {
        return res.status(400).json({
          message: "Verified bank account details are required",
        });
      }

      payload = {
        ...payload,
        accountName: resolvedAccountName,
        accountNumber: resolvedAccountNumber,
        ifsc: resolvedIfsc,
      };
    }

    const withdraw = await Withdraw.create(payload);

    const summary = await getFemaleWithdrawSummary(userId);

    return res.json({
      message: "Withdraw request submitted",
      withdraw: formatWithdrawRecord(withdraw),
      summary,
    });
  } catch (error) {
    const message = error?.message || "Unable to submit withdraw request";
    const status = message.includes("Insufficient") ? 400 : 500;

    return res.status(status).json({
      message,
    });
  }
};

export const getWithdrawSummary = async (req, res) => {
  try {
    const summary = await getFemaleWithdrawSummary(req.params.userId);

    return res.json(summary);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const withdrawHistory = async (req, res) => {
  try {
    const [history, summary] = await Promise.all([
      Withdraw.findAll({
        where: {
          userId: req.params.userId,
        },
        order: [["createdAt", "DESC"]],
      }),
      getFemaleWithdrawSummary(req.params.userId),
    ]);

    return res.json({
      history: history.map(formatWithdrawRecord),
      summary,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
