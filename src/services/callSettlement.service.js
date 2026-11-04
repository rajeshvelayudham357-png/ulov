import { Op, QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { normalizeCallTypeForDb } from "../constants/callTypes.js";
import { CallHistory, Wallet } from "../models/index.js";
import { computeInitialCallCharge } from "../utils/callSettlement.util.js";
import {
  getCallRateSettings,
  getEffectiveCreatorCallRates,
} from "./callRate.service.js";

export const CALL_CHARGE_DESCRIPTION = "Call charge";
export const CALL_CHARGE_REFERENCE_TYPE = "call";

/** Coins actually debited from the caller's wallet for this call. */
export const getCollectedCallCoins = async ({
  callId,
  callerId,
  transaction = null,
}) => {
  const rows = await sequelize.query(
    `SELECT COALESCE(SUM(amount), 0) AS collected
     FROM wallet_transactions
     WHERE type = 'debit'
       AND referenceType = :referenceType
       AND referenceId = :callId
       AND userId = :callerId`,
    {
      replacements: {
        referenceType: CALL_CHARGE_REFERENCE_TYPE,
        callId: Number(callId),
        callerId: Number(callerId),
      },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  return Math.max(0, Math.floor(Number(rows[0]?.collected) || 0));
};

/** Per-minute rate for a call, honouring per-creator overrides. */
export const getCallRatePerMinute = async ({ type, receiverId = null }) => {
  const settings = await getCallRateSettings();
  const rates = receiverId
    ? await getEffectiveCreatorCallRates(receiverId, settings)
    : {
        voiceRatePerMinute: settings.voiceRatePerMinute,
        videoRatePerMinute: settings.videoRatePerMinute,
      };

  return normalizeCallTypeForDb(type) === "voice"
    ? Number(rates.voiceRatePerMinute)
    : Number(rates.videoRatePerMinute);
};

/** Largest single billing interval the app can legitimately charge for a call. */
export const getMaxIntervalCharge = async ({ receiverId = null }) => {
  const settings = await getCallRateSettings();
  const rates = receiverId
    ? await getEffectiveCreatorCallRates(receiverId, settings)
    : {
        voiceRatePerMinute: settings.voiceRatePerMinute,
        videoRatePerMinute: settings.videoRatePerMinute,
      };

  return Math.ceil(
    Math.max(Number(rates.voiceRatePerMinute) || 0, Number(rates.videoRatePerMinute) || 0)
  );
};

export const getInitialCallCharge = async ({ type, receiverId = null }) =>
  computeInitialCallCharge({
    type: normalizeCallTypeForDb(type),
    ratePerMinute: await getCallRatePerMinute({ type, receiverId }),
  });

export class InsufficientCallBalanceError extends Error {
  constructor({ required, balance }) {
    super(`You need at least ${required} coins to start this call`);
    this.name = "InsufficientCallBalanceError";
    this.statusCode = 402;
    this.code = "INSUFFICIENT_BALANCE";
    this.required = required;
    this.balance = balance;
  }
}

/** Throws when the caller cannot pay for the first billing interval. */
export const assertCanAffordInitialCallCharge = async ({
  callerId,
  type,
  receiverId = null,
}) => {
  const required = await getInitialCallCharge({ type, receiverId });
  const wallet = await Wallet.findOne({ where: { userId: Number(callerId) } });
  const balance = Math.max(0, Number(wallet?.balance) || 0);

  if (balance < required) {
    throw new InsufficientCallBalanceError({ required, balance });
  }

  return { required, balance };
};

/** Records the first time the server sees the call accepted. Idempotent. */
export const markCallAccepted = async (callId) => {
  const id = Number(callId);

  if (!Number.isFinite(id) || id <= 0) {
    return;
  }

  await CallHistory.update(
    { acceptedAt: new Date() },
    { where: { id, acceptedAt: { [Op.is]: null } } }
  );
};
