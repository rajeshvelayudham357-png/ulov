import { Op, QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { CallHistory, Wallet, WalletTransaction } from "../models/index.js";
import {
  describeInterval,
  getDueIntervalCount,
  getIntervalAmount,
  getIntervalEndSecond,
} from "../utils/callBillingSchedule.util.js";
import { ensureCallBillingSchema } from "./callBillingSchema.service.js";
import {
  CALL_CHARGE_DESCRIPTION,
  CALL_CHARGE_REFERENCE_TYPE,
  getCallRatePerMinute,
  getCollectedCallCoins,
} from "./callSettlement.service.js";
import { ACTIVE_CALL_STATUSES, completeCallRecord } from "./callState.service.js";

/**
 * Phase 2 server-authoritative call billing.
 *
 * CALL_BILLING_MODE:
 *   client (default) - the phone charges, as before.
 *   shadow           - the phone charges; the server records what it would
 *                      have charged (shadow interval rows, no debit).
 *   server           - calls from app builds that support it are charged by
 *                      the server; older builds keep charging from the phone.
 *                      A call is never charged by both: /wallet/spend ignores
 *                      server-billed calls.
 */
export const CALL_BILLING_MODES = {
  CLIENT: "client",
  SHADOW: "shadow",
  SERVER: "server",
};

export const SERVER_BILLING_CAPABILITY = "server";

export const getCallBillingMode = () => {
  const value = String(process.env.CALL_BILLING_MODE || "").trim().toLowerCase();
  return Object.values(CALL_BILLING_MODES).includes(value) ? value : CALL_BILLING_MODES.CLIENT;
};

export const resolveBillingModeForNewCall = ({ capability } = {}) => {
  const mode = getCallBillingMode();

  if (mode === CALL_BILLING_MODES.SERVER) {
    return capability === SERVER_BILLING_CAPABILITY
      ? CALL_BILLING_MODES.SERVER
      : CALL_BILLING_MODES.CLIENT;
  }

  return mode;
};

/** Billing fields to store on a new call row. */
export const getNewCallBillingFields = async ({ capability, type, receiverId }) => {
  const billingMode = resolveBillingModeForNewCall({ capability });

  if (billingMode === CALL_BILLING_MODES.CLIENT) {
    return { billingMode };
  }

  return {
    billingMode,
    billingRatePerMinute: await getCallRatePerMinute({ type, receiverId }),
    billableSeconds: 0,
  };
};

const getHeartbeatTimeoutMs = () => {
  const value = Number(process.env.CALL_HEARTBEAT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 90_000;
};

const TICK_MS = 1000;
const SYNC_MS = 5000;
const PERSIST_MS = 5000;

const isVoice = (type) => ["voice", "audio"].includes(String(type).toLowerCase());

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/** Debits one interval. Repeated or concurrent calls for the same interval charge once. */
export const chargeCallInterval = async ({ callId, intervalIndex, shadow = false }) => {
  try {
    return await sequelize.transaction(async (transaction) => {
      const call = await CallHistory.findByPk(callId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (
        !call ||
        !call.acceptedAt ||
        call.settledAt ||
        !ACTIVE_CALL_STATUSES.includes(call.status)
      ) {
        return { inactive: true };
      }

      const rate = toNumber(call.billingRatePerMinute, 0);
      const interval = describeInterval(call.type, intervalIndex, rate);

      const [existing] = await sequelize.query(
        `SELECT id FROM call_billing_intervals
         WHERE callId = :callId AND intervalIndex = :intervalIndex AND shadow = :shadow
         LIMIT 1`,
        {
          replacements: { callId: call.id, intervalIndex, shadow: shadow ? 1 : 0 },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (existing) {
        return { duplicate: true };
      }

      let walletTransactionId = null;

      if (!shadow) {
        const [updated] = await Wallet.update(
          { balance: sequelize.literal(`balance - ${interval.amount}`) },
          {
            where: { userId: call.callerId, balance: { [Op.gte]: interval.amount } },
            transaction,
          }
        );

        if (!updated) {
          return { insufficient: true, required: interval.amount };
        }

        // Same ledger row the phone's charges used, so settlement and
        // reconciliation read server and client charges identically.
        const ledger = await WalletTransaction.findOne({
          where: {
            userId: call.callerId,
            type: "debit",
            description: CALL_CHARGE_DESCRIPTION,
            referenceType: CALL_CHARGE_REFERENCE_TYPE,
            referenceId: call.id,
          },
          order: [["createdAt", "DESC"]],
          transaction,
        });

        if (ledger) {
          await ledger.update(
            { amount: toNumber(ledger.amount) + interval.amount },
            { transaction }
          );
          walletTransactionId = ledger.id;
        } else {
          const created = await WalletTransaction.create(
            {
              userId: call.callerId,
              type: "debit",
              amount: interval.amount,
              description: CALL_CHARGE_DESCRIPTION,
              referenceId: call.id,
              referenceType: CALL_CHARGE_REFERENCE_TYPE,
            },
            { transaction }
          );
          walletTransactionId = created.id;
        }
      }

      await sequelize.query(
        `INSERT INTO call_billing_intervals
         (callId, intervalIndex, shadow, coversFromSecond, coversToSecond, amount, walletTransactionId)
         VALUES (:callId, :intervalIndex, :shadow, :coversFromSecond, :coversToSecond, :amount, :walletTransactionId)`,
        {
          replacements: {
            callId: call.id,
            intervalIndex,
            shadow: shadow ? 1 : 0,
            coversFromSecond: interval.coversFromSecond,
            coversToSecond: interval.coversToSecond,
            amount: interval.amount,
            walletTransactionId,
          },
          transaction,
        }
      );

      return { charged: !shadow, recorded: true, amount: interval.amount };
    });
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError") {
      return { duplicate: true };
    }

    throw error;
  }
};

const loadActiveBilledCalls = async () =>
  sequelize.query(
    `SELECT id, callerId, receiverId, type, billingMode, billingRatePerMinute,
            billableSeconds, acceptedAt
     FROM call_histories
     WHERE billingMode IN ('server', 'shadow')
       AND acceptedAt IS NOT NULL
       AND settledAt IS NULL
       AND status IN (:statuses)`,
    { replacements: { statuses: ACTIVE_CALL_STATUSES }, type: QueryTypes.SELECT }
  );

// Covers a phone charge request still in flight at the boundary.
const PHONE_BILLING_GRACE_SECONDS = 3;
const PHONE_BILLING_CHECK_MS = 2000;

const loadPhoneBilledCalls = async () =>
  sequelize.query(
    `SELECT id, callerId, receiverId, type, billingRatePerMinute, acceptedAt
     FROM call_histories
     WHERE (billingMode IS NULL OR billingMode IN ('client', 'shadow'))
       AND acceptedAt IS NOT NULL
       AND settledAt IS NULL
       AND status IN (:statuses)`,
    { replacements: { statuses: ACTIVE_CALL_STATUSES }, type: QueryTypes.SELECT }
  );

/** How far into the call the collected coins pay for, and the next interval's price. */
export const getPaidCoverage = (type, ratePerMinute, collectedCoins) => {
  let remaining = Math.max(0, Math.floor(Number(collectedCoins) || 0));
  let index = 0;

  for (;;) {
    const amount = getIntervalAmount(type, index, ratePerMinute);

    if (remaining < amount) {
      return {
        paidUntilSecond: index > 0 ? getIntervalEndSecond(type, index - 1) : 0,
        nextAmount: amount,
      };
    }

    remaining -= amount;
    index += 1;
  }
};

const countRecordedIntervals = async (callId, shadow) => {
  const [row] = await sequelize.query(
    `SELECT COALESCE(MAX(intervalIndex) + 1, 0) AS count
     FROM call_billing_intervals
     WHERE callId = :callId AND shadow = :shadow`,
    { replacements: { callId, shadow: shadow ? 1 : 0 }, type: QueryTypes.SELECT }
  );
  return toNumber(row?.count);
};

/**
 * In-memory scheduler over server/shadow-billed calls. The database is the
 * source of truth: sessions are (re)loaded from it, so a restart resumes from
 * the persisted billable seconds and recorded intervals.
 */
export const createCallBillingEngine = ({
  emitToUser = () => {},
  now = () => Date.now(),
  heartbeatTimeoutMs = getHeartbeatTimeoutMs(),
} = {}) => {
  const sessions = new Map();
  let tickRunning = false;
  let timers = [];

  const findSessionByPair = (callerId, receiverId) => {
    for (const session of sessions.values()) {
      if (
        String(session.callerId) === String(callerId) &&
        String(session.receiverId) === String(receiverId)
      ) {
        return session;
      }
    }
    return null;
  };

  const sync = async () => {
    await ensureCallBillingSchema();
    const rows = await loadActiveBilledCalls();
    const activeIds = new Set(rows.map((row) => Number(row.id)));

    for (const id of sessions.keys()) {
      if (!activeIds.has(id)) {
        sessions.delete(id);
      }
    }

    const nowMs = now();

    for (const row of rows) {
      const id = Number(row.id);

      if (sessions.has(id)) {
        continue;
      }

      const shadow = row.billingMode === CALL_BILLING_MODES.SHADOW;
      const acceptedMs = new Date(row.acceptedAt).getTime();
      // A fresh call counts from its accept time; a call resumed after a
      // restart continues from what was persisted (downtime is not billed).
      const billableMs =
        row.billableSeconds === null || row.billableSeconds === undefined
          ? Math.max(0, nowMs - acceptedMs)
          : toNumber(row.billableSeconds) * 1000;

      sessions.set(id, {
        callId: id,
        callerId: Number(row.callerId),
        receiverId: Number(row.receiverId),
        type: row.type,
        shadow,
        billableMs,
        lastTickMs: nowMs,
        lastPersistMs: nowMs,
        chargedCount: await countRecordedIntervals(id, shadow),
        acceptedMs,
        ratePerMinute: toNumber(row.billingRatePerMinute),
        lastAffordCheckMs: 0,
        faceDetected: true,
        restrictEnabled: true,
        callerHeartbeatMs: nowMs,
        receiverHeartbeatMs: null,
      });
    }
  };

  const persist = async (session) => {
    session.lastPersistMs = now();
    await CallHistory.update(
      { billableSeconds: Math.floor(session.billableMs / 1000) },
      { where: { id: session.callId, settledAt: null } }
    );
  };

  const endSession = async (session, reason) => {
    sessions.delete(session.callId);
    await persist(session);

    const result = await completeCallRecord({
      callerId: session.callerId,
      receiverId: session.receiverId,
      type: session.type,
      callHistoryId: session.callId,
      endReason: reason,
      endedAt: new Date(now()),
    });

    const payload = { callId: String(session.callId), reason };
    emitToUser(session.callerId, "call-billing-ended", payload);
    emitToUser(session.receiverId, "call-billing-ended", payload);

    return result;
  };

  const billSession = async (session) => {
    const nowMs = now();
    const elapsed = Math.max(0, nowMs - session.lastTickMs);
    session.lastTickMs = nowMs;

    const billable =
      isVoice(session.type) || session.faceDetected || !session.restrictEnabled;

    if (billable) {
      session.billableMs += elapsed;
    }

    if (!session.shadow) {
      const callerLapsed = nowMs - session.callerHeartbeatMs > heartbeatTimeoutMs;
      const receiverLapsed =
        session.receiverHeartbeatMs !== null &&
        nowMs - session.receiverHeartbeatMs > heartbeatTimeoutMs;

      if (callerLapsed || receiverLapsed) {
        await endSession(session, "heartbeat_timeout");
        return;
      }
    }

    const due = getDueIntervalCount(session.type, Math.floor(session.billableMs / 1000));

    while (sessions.has(session.callId) && session.chargedCount < due) {
      const result = await chargeCallInterval({
        callId: session.callId,
        intervalIndex: session.chargedCount,
        shadow: session.shadow,
      });

      if (result.inactive) {
        sessions.delete(session.callId);
        return;
      }

      if (result.insufficient) {
        await endSession(session, "insufficient_balance");
        return;
      }

      session.chargedCount += 1;

      if (result.charged) {
        const wallet = await Wallet.findOne({ where: { userId: session.callerId } });
        emitToUser(session.callerId, "wallet-updated", {
          balance: toNumber(wallet?.balance),
        });
      }
    }

    if (!sessions.has(session.callId)) {
      return;
    }

    // A face-check pause stops charges but must not keep an unpaid call open:
    // once the paid time has passed on the wall clock and the next interval is
    // unaffordable, end the call.
    if (!billable && !session.shadow && session.chargedCount > 0) {
      const paidUntilSecond = getIntervalEndSecond(session.type, session.chargedCount - 1);
      const wallSeconds = Math.floor((nowMs - session.acceptedMs) / 1000);

      if (wallSeconds >= paidUntilSecond && nowMs - session.lastAffordCheckMs >= PERSIST_MS) {
        session.lastAffordCheckMs = nowMs;
        const nextAmount = getIntervalAmount(
          session.type,
          session.chargedCount,
          session.ratePerMinute
        );
        const wallet = await Wallet.findOne({ where: { userId: session.callerId } });

        if (toNumber(wallet?.balance) < nextAmount) {
          await endSession(session, "insufficient_balance");
          return;
        }
      }
    }

    if (now() - session.lastPersistMs >= PERSIST_MS) {
      await persist(session);
    }
  };

  const tick = async () => {
    if (tickRunning) {
      return;
    }

    tickRunning = true;

    try {
      for (const session of [...sessions.values()]) {
        try {
          await billSession(session);
        } catch (error) {
          console.log("CALL BILLING TICK ERROR", session.callId, error.message);
        }
      }
    } finally {
      tickRunning = false;
    }
  };

  /**
   * Phone-billed calls: the phone charges, but a minimized (suspended) app
   * cannot charge or hang up. End the call once its paid time has run out on
   * the server's clock and the caller cannot afford the next interval, so the
   * creator is not left on an unpaid call.
   */
  const enforcePhoneBilledCalls = async () => {
    const nowMs = now();
    const rows = await loadPhoneBilledCalls();
    const ended = [];

    for (const row of rows) {
      try {
        const rate =
          toNumber(row.billingRatePerMinute) ||
          (await getCallRatePerMinute({ type: row.type, receiverId: row.receiverId }));
        const collected = await getCollectedCallCoins({
          callId: row.id,
          callerId: row.callerId,
        });
        const wallet = await Wallet.findOne({ where: { userId: row.callerId } });

        // Everything he has paid plus everything he still could pay: once the
        // call runs past that, no phone charge can cover it any more.
        const { paidUntilSecond: affordableUntilSecond } = getPaidCoverage(
          row.type,
          rate,
          collected + Math.max(0, toNumber(wallet?.balance))
        );
        const wallSeconds = Math.floor((nowMs - new Date(row.acceptedAt).getTime()) / 1000);

        if (wallSeconds < affordableUntilSecond + PHONE_BILLING_GRACE_SECONDS) {
          continue;
        }

        await completeCallRecord({
          callerId: row.callerId,
          receiverId: row.receiverId,
          type: row.type,
          callHistoryId: row.id,
          endReason: "insufficient_balance",
          endedAt: new Date(nowMs),
        });

        const payload = { callId: String(row.id), reason: "insufficient_balance" };
        emitToUser(row.callerId, "call-billing-ended", payload);
        emitToUser(row.receiverId, "call-billing-ended", payload);
        ended.push(Number(row.id));
      } catch (error) {
        console.log("PHONE BILLING CHECK ERROR", row.id, error.message);
      }
    }

    return ended;
  };

  return {
    sessions,
    sync,
    tick,
    enforcePhoneBilledCalls,

    /** Picks up newly accepted calls right away instead of on the next sync. */
    async refresh() {
      try {
        await sync();
        await tick();
      } catch (error) {
        console.log("CALL BILLING REFRESH ERROR", error.message);
      }
    },

    recordHeartbeat({ callId, userId }) {
      const session = sessions.get(Number(callId));

      if (!session || !userId) {
        return false;
      }

      if (String(userId) === String(session.callerId)) {
        session.callerHeartbeatMs = now();
        return true;
      }

      if (String(userId) === String(session.receiverId)) {
        session.receiverHeartbeatMs = now();
        return true;
      }

      return false;
    },

    recordFaceStatus({ creatorId, callerId, faceDetected }) {
      const session = findSessionByPair(callerId, creatorId);

      if (session) {
        session.faceDetected = Boolean(faceDetected);
      }
    },

    recordFaceRestrict({ callerId, creatorId, restrictEnabled }) {
      const session = findSessionByPair(callerId, creatorId);

      if (session) {
        session.restrictEnabled = Boolean(restrictEnabled);
      }
    },

    start() {
      if (timers.length) {
        return;
      }

      const syncTimer = setInterval(() => {
        sync().catch((error) => console.log("CALL BILLING SYNC ERROR", error.message));
      }, SYNC_MS);
      const tickTimer = setInterval(() => {
        void tick();
      }, TICK_MS);
      let phoneCheckRunning = false;
      const phoneCheckTimer = setInterval(() => {
        if (phoneCheckRunning) {
          return;
        }
        phoneCheckRunning = true;
        enforcePhoneBilledCalls()
          .catch((error) => console.log("PHONE BILLING CHECK ERROR", error.message))
          .finally(() => {
            phoneCheckRunning = false;
          });
      }, PHONE_BILLING_CHECK_MS);
      syncTimer.unref?.();
      tickTimer.unref?.();
      phoneCheckTimer.unref?.();
      timers = [syncTimer, tickTimer, phoneCheckTimer];

      void this.refresh();
    },

    stop() {
      timers.forEach(clearInterval);
      timers = [];
    },
  };
};

let sharedEngine = null;

export const initCallBillingEngine = ({ io, onlineUsers }) => {
  sharedEngine = createCallBillingEngine({
    emitToUser: (userId, event, payload) => {
      const socketId = onlineUsers.get(String(userId));
      if (socketId) {
        io.to(socketId).emit(event, payload);
      }
    },
  });
  sharedEngine.start();
  return sharedEngine;
};

export const getCallBillingEngine = () => sharedEngine;
