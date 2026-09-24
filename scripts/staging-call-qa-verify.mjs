#!/usr/bin/env node
/**
 * Post-scenario financial snapshot for staging / real-device QA.
 * Usage: node scripts/staging-call-qa-verify.mjs <callHistoryId>
 *
 * Requires DB env from src/config/.env (same as backend).
 * Read-only queries only.
 */
import { sequelize } from "../src/config/database.js";
import { CallHistory, Earning, WalletTransaction } from "../src/models/index.js";

const callId = Number(process.argv[2]);

if (!Number.isFinite(callId) || callId <= 0) {
  console.error("Usage: node scripts/staging-call-qa-verify.mjs <callHistoryId>");
  process.exit(1);
}

const main = async () => {
  const history = await CallHistory.findByPk(callId);

  if (!history) {
    console.log(
      JSON.stringify(
        { ok: false, error: "call_histories row not found", callId },
        null,
        2
      )
    );
    process.exit(2);
  }

  const earnings = await Earning.findAll({
    where: { callId },
    order: [["id", "ASC"]],
  });

  const walletTx = await WalletTransaction.findAll({
    where: { referenceId: callId },
    order: [["id", "ASC"]],
  });

  const legacyWalletTx = await WalletTransaction.findAll({
    where: {
      userId: history.callerId,
      type: "Call charge",
    },
    order: [["createdAt", "DESC"]],
    limit: 20,
  });

  const payload = {
    ok: true,
    capturedAt: new Date().toISOString(),
    callId,
    callHistory: {
      id: history.id,
      callerId: history.callerId,
      receiverId: history.receiverId,
      type: history.type,
      duration: Number(history.duration ?? 0),
      coinsSpent: Number(history.coinsSpent ?? 0),
      status: history.status,
      createdAt: history.createdAt,
      updatedAt: history.updatedAt,
    },
    counts: {
      earningRows: earnings.length,
      walletTransactionsByReferenceId: walletTx.length,
    },
    earnings: earnings.map((row) => ({
      id: row.id,
      userId: row.userId,
      coins: Number(row.coins ?? 0),
      amount: Number(row.amount ?? 0),
      duration: Number(row.duration ?? 0),
      status: row.status,
    })),
    walletTransactionsReferenceId: walletTx.map((row) => ({
      id: row.id,
      userId: row.userId,
      type: row.type,
      amount: Number(row.amount ?? 0),
      referenceId: row.referenceId,
      createdAt: row.createdAt,
    })),
    walletTransactionsRecentCallChargeCaller: legacyWalletTx.map((row) => ({
      id: row.id,
      amount: Number(row.amount ?? 0),
      referenceId: row.referenceId,
      createdAt: row.createdAt,
    })),
    passHints: {
      zeroBillingExpected:
        Number(history.coinsSpent) === 0 && earnings.length === 0,
      duplicateEarningSuspect: earnings.length > 1,
      duplicateWalletByRefSuspect: walletTx.length > 1,
    },
  };

  console.log(JSON.stringify(payload, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
