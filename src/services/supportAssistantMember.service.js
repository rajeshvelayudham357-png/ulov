import { Op, QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { MEMBER_INTENT_RULES } from "../constants/supportAssistantMemberI18n.js";
import { AccountDeletionRequest, CallHistory, PaymentOrder, User, Wallet } from "../models/index.js";
import { classifyRechargeOutcome, syncPaymentOrder } from "./payment.service.js";
import {
  getCallRatePerMinute,
  getCollectedCallCoins,
  getInitialCallCharge,
} from "./callSettlement.service.js";
import { getMaleReferralStatus } from "./referral.service.js";
import { englishDateTime, formatRupees, HOUR_MS, reply } from "./supportAssistantShared.js";

/**
 * Support assistant answers for male members: recharges, coin charges, call
 * problems, account and referral bonus. A payment that is still unconfirmed is
 * re-checked with its gateway, which credits the coins if it actually went
 * through.
 */

export const MEMBER_TOPIC_DEFS = [
  { id: "recharge", icon: "cash-plus", category: "Recharge & payments" },
  { id: "coins", icon: "circle-multiple-outline", category: "Coins & call charges" },
  { id: "calls", icon: "phone-alert-outline", category: "Call problems" },
  { id: "account", icon: "account-cog-outline", category: "Account" },
  { id: "referral", icon: "ticket-percent-outline", category: "Referral bonus" },
  { id: "other", icon: "chat-question-outline", category: "Something else" },
];

export const MEMBER_DEFAULT_INTENT = {
  recharge: "status",
  coins: "charges",
  calls: "diagnose",
  account: "status",
  referral: "status",
};

// Call problems are checked before coin charges: "call cut" must not read as "coins cut".
const ORDERED_RULES = ["recharge", "calls", "coins", "account", "referral"].map((topic) =>
  MEMBER_INTENT_RULES.find((rule) => rule.topic === topic)
);

export const detectMemberIntent = (input) => {
  const value = String(input || "").toLowerCase();

  if (!value.trim()) {
    return null;
  }

  for (const rule of ORDERED_RULES) {
    if (rule.words.some((word) => value.includes(word.toLowerCase()))) {
      return { topic: rule.topic, intent: rule.intent };
    }
  }

  return null;
};

const SYNCABLE_GATEWAYS = new Set(["razorpay", "payu", "phonepe", "cashfree"]);
const CONFIRM_GRACE_MS = 2 * 60 * 1000;
const PENDING_ESCALATE_MS = 30 * 60 * 1000;
const REFUND_WINDOW_MS = 7 * 24 * HOUR_MS;
const SYNC_COOLDOWN_MS = 60 * 1000;
const lastSyncAt = new Map();

const walletBalance = async (userId) =>
  Number((await Wallet.findOne({ where: { userId } }))?.balance ?? 0);

const walletCard = async (ctx) =>
  ctx.card(ctx.t("card.wallet"), [
    ctx.row(ctx.t("row.balance"), ctx.t("val.coins", { coins: await walletBalance(ctx.user.id) }), "positive"),
  ]);

const orderStatusLabel = (t, outcome) =>
  ({
    added: t("val.added"),
    failed: t("val.failed"),
    cancelled: t("val.cancelled"),
  })[outcome] || t("val.pending");

const orderCard = (ctx, order, outcome) =>
  ctx.card(
    ctx.t("card.order", { id: order.orderId }),
    [
      ctx.row(ctx.t("row.amount"), formatRupees(order.amount)),
      ctx.row(ctx.t("row.coins"), Number(order.coins || 0).toLocaleString("en-IN")),
      ctx.row(ctx.t("row.time"), ctx.dateTime(order.createdAt)),
      ctx.row(
        ctx.t("row.status"),
        orderStatusLabel(ctx.t, outcome),
        outcome === "added" ? "positive" : outcome === "incomplete" ? "warning" : "danger"
      ),
    ],
    outcome === "added" ? "positive" : outcome === "incomplete" ? "warning" : "danger"
  );

/** Asks the gateway about an unconfirmed order; crediting is idempotent. */
const recheckWithGateway = async (ctx, order) => {
  const gateway = String(order.gateway || "").toLowerCase();

  if (!SYNCABLE_GATEWAYS.has(gateway)) {
    return false;
  }

  const last = lastSyncAt.get(order.orderId) || 0;

  if (ctx.now.getTime() - last < SYNC_COOLDOWN_MS) {
    return false;
  }

  lastSyncAt.set(order.orderId, ctx.now.getTime());

  try {
    const sync = ctx.deps.syncOrder || syncPaymentOrder;
    const result = await sync(order.orderId);
    await order.reload();
    return Boolean(result?.credited);
  } catch (error) {
    console.log("SUPPORT ASSISTANT PAYMENT SYNC ERROR", order.orderId, error.message);
    return false;
  }
};

const rechargeStatus = async (ctx) => {
  const { user, now, t, text, suggestion, duration } = ctx;
  const orders = await PaymentOrder.findAll({
    where: { userId: user.id, createdAt: { [Op.gte]: new Date(now.getTime() - REFUND_WINDOW_MS * 2) } },
    order: [["createdAt", "DESC"]],
    limit: 5,
  });

  const followUps = [suggestion("coins", "charges", "ms.coinsDeducted")];

  if (!orders.length) {
    return reply({
      topic: "recharge",
      intent: "status",
      resolution: "resolved",
      messages: [text(t("mr.none")), await walletCard(ctx)],
      suggestions: followUps,
    });
  }

  const order = orders[0];
  const age = now.getTime() - new Date(order.createdAt).getTime();
  let outcome = classifyRechargeOutcome(order.status);
  const summary = () => [
    `Order ${order.orderId}: ${formatRupees(order.amount)} for ${order.coins} coins via ${order.gateway || "unknown"}`,
    `Created ${englishDateTime(order.createdAt)}, status ${order.status}`,
  ];

  if (outcome === "incomplete" && age >= CONFIRM_GRACE_MS) {
    const credited = await recheckWithGateway(ctx, order);
    outcome = classifyRechargeOutcome(order.status);

    if (credited || outcome === "added") {
      return reply({
        topic: "recharge",
        intent: "status",
        resolution: "resolved",
        messages: [
          text(t("mr.syncCredited", { coins: order.coins })),
          orderCard(ctx, order, "added"),
          await walletCard(ctx),
        ],
        suggestions: followUps,
      });
    }
  }

  if (outcome === "added") {
    return reply({
      topic: "recharge",
      intent: "status",
      resolution: "resolved",
      messages: [
        text(t("mr.added", { amount: formatRupees(order.amount), coins: order.coins })),
        orderCard(ctx, order, outcome),
        await walletCard(ctx),
      ],
      suggestions: followUps,
    });
  }

  if (outcome === "incomplete") {
    if (age < CONFIRM_GRACE_MS) {
      return reply({
        topic: "recharge",
        intent: "status",
        resolution: "wait",
        messages: [text(t("mr.verifyingSoon")), orderCard(ctx, order, outcome)],
        escalation: { allowed: false, reason: t("reason.confirming") },
      });
    }

    if (age < PENDING_ESCALATE_MS) {
      return reply({
        topic: "recharge",
        intent: "status",
        resolution: "wait",
        messages: [text(t("mr.stillPending")), orderCard(ctx, order, outcome)],
        escalation: {
          allowed: false,
          reason: t("reason.confirming"),
          availableAt: new Date(new Date(order.createdAt).getTime() + PENDING_ESCALATE_MS).toISOString(),
        },
      });
    }

    return reply({
      topic: "recharge",
      intent: "status",
      resolution: "escalate",
      messages: [text(t("mr.pendingLong", { ago: duration(age) })), orderCard(ctx, order, outcome)],
      escalation: { allowed: true, subject: `Recharge order ${order.orderId} not confirmed` },
      summary: summary(),
    });
  }

  // Failed or cancelled.
  const overdue = age > REFUND_WINDOW_MS;

  return reply({
    topic: "recharge",
    intent: "status",
    resolution: overdue ? "escalate" : "resolved",
    messages: [
      text(t("mr.failed")),
      orderCard(ctx, order, outcome),
      text(t("mr.refundInfo")),
      ...(overdue ? [text(t("mr.refundOverdue"))] : []),
    ],
    escalation: overdue
      ? { allowed: true, subject: `Failed recharge ${order.orderId} — refund not received` }
      : { allowed: false, reason: t("reason.refundWindow") },
    suggestions: followUps,
    summary: summary(),
  });
};

const coinCharges = async (ctx) => {
  const { user, now, t, text, card, row, dateTime, callTypeLabel } = ctx;
  const calls = await CallHistory.findAll({
    where: { callerId: user.id, createdAt: { [Op.gte]: new Date(now.getTime() - 48 * HOUR_MS) } },
    order: [["createdAt", "DESC"]],
    limit: 5,
  });

  const [voiceRate, videoRate] = await Promise.all([
    getCallRatePerMinute({ type: "voice" }),
    getCallRatePerMinute({ type: "video" }),
  ]);
  const ratesCard = card(t("card.rates"), [
    row(t("row.voiceRate"), t("val.perMin", { coins: voiceRate })),
    row(t("row.videoRate"), t("val.perMin", { coins: videoRate })),
  ]);

  if (!calls.length) {
    return reply({
      topic: "coins",
      intent: "charges",
      resolution: "resolved",
      messages: [text(t("mc.noCalls")), ratesCard, text(t("mc.giftsNote"))],
    });
  }

  const charged = await Promise.all(
    calls.map(async (call) => ({
      call,
      coins: await getCollectedCallCoins({ callId: call.id, callerId: user.id }),
    }))
  );

  // Coins taken for a call that was never answered. A short answered call is
  // legitimately charged its first prepaid interval.
  const suspect = charged.find(({ call, coins }) => coins > 0 && !call.acceptedAt);

  return reply({
    topic: "coins",
    intent: "charges",
    resolution: suspect ? "escalate" : "resolved",
    messages: [
      text(t("mc.intro")),
      card(
        t("card.recentCalls"),
        charged.map(({ call, coins }) =>
          row(
            t("row.callLabel", {
              time: dateTime(call.createdAt),
              minutes: Math.round(Number(call.duration || 0) / 60),
              type: callTypeLabel(call.type),
            }),
            t("val.coins", { coins }),
            suspect?.call.id === call.id ? "danger" : "neutral"
          )
        )
      ),
      ratesCard,
      text(t("mc.howCharged")),
      ...(suspect ? [text(t("mc.suspect", { id: suspect.call.id, coins: suspect.coins }))] : [text(t("mc.giftsNote"))]),
    ],
    escalation: suspect
      ? { allowed: true, subject: `Charged ${suspect.coins} coins for call #${suspect.call.id} that didn't connect` }
      : { allowed: true, subject: "Question about coin charges" },
    summary: charged.map(
      ({ call, coins }) =>
        `Call #${call.id} ${englishDateTime(call.createdAt)}: ${call.duration || 0}s, ${coins} coins, status ${call.status}, accepted ${call.acceptedAt ? "yes" : "no"}`
    ),
  });
};

const END_REASON_KEYS = new Set([
  "insufficient_balance",
  "heartbeat_timeout",
  "participant_disconnected",
  "caller_ended",
  "receiver_ended",
]);

const callProblems = async (ctx) => {
  const { user, now, t, text, card, row, suggestion } = ctx;
  const [[statusRow], balance, minVideo, minVoice, lastCall] = await Promise.all([
    sequelize.query("SELECT blocked FROM users WHERE id = :id LIMIT 1", {
      replacements: { id: user.id },
      type: QueryTypes.SELECT,
    }),
    walletBalance(user.id),
    getInitialCallCharge({ type: "video" }),
    getInitialCallCharge({ type: "voice" }),
    CallHistory.findOne({
      where: { callerId: user.id, acceptedAt: { [Op.ne]: null } },
      order: [["createdAt", "DESC"]],
    }),
  ]);

  const endReason = lastCall?.endReason && END_REASON_KEYS.has(lastCall.endReason) ? lastCall.endReason : "other";
  const recent = lastCall && now.getTime() - new Date(lastCall.createdAt).getTime() < 24 * HOUR_MS;
  const minimum = Math.min(minVideo, minVoice);

  const checkCard = card(t("card.callCheck"), [
    row(t("row.balance"), t("val.coins", { coins: balance }), balance >= minimum ? "positive" : "danger"),
    row(t("row.minVoice"), t("val.coins", { coins: minVoice })),
    row(t("row.minVideo"), t("val.coins", { coins: minVideo })),
    ...(lastCall ? [row(t("row.lastCall"), t(`mk.end.${endReason}`))] : []),
  ]);

  const summary = [
    `Balance ${balance} coins (voice needs ${minVoice}, video needs ${minVideo})`,
    lastCall ? `Last call #${lastCall.id} ${englishDateTime(lastCall.createdAt)}, ended: ${lastCall.endReason || "unknown"}` : "No answered calls",
  ];

  if (Number(statusRow?.blocked) === 1) {
    return reply({
      topic: "calls",
      intent: "diagnose",
      resolution: "escalate",
      messages: [text(t("mk.intro")), checkCard, text(t("mk.restricted"))],
      escalation: { allowed: true, subject: "Account restricted — cannot call" },
      summary,
    });
  }

  if (balance < minimum) {
    return reply({
      topic: "calls",
      intent: "diagnose",
      resolution: "resolved",
      messages: [text(t("mk.intro")), checkCard, text(t("mk.lowBalance", { coins: minimum }))],
      suggestions: [suggestion("recharge", "status", "ms.coinsNotAdded")],
    });
  }

  if (recent && endReason === "insufficient_balance") {
    return reply({
      topic: "calls",
      intent: "diagnose",
      resolution: "resolved",
      messages: [text(t("mk.intro")), checkCard, text(t("mk.lastCallCoins"))],
      suggestions: [suggestion("coins", "charges", "ms.coinsDeducted")],
    });
  }

  if (recent && (endReason === "heartbeat_timeout" || endReason === "participant_disconnected")) {
    return reply({
      topic: "calls",
      intent: "diagnose",
      resolution: "resolved",
      messages: [text(t("mk.intro")), checkCard, text(t("mk.lastCallLost"))],
      escalation: { allowed: true, subject: "Calls keep disconnecting" },
      suggestions: [suggestion("coins", "charges", "ms.coinsDeducted")],
      summary,
    });
  }

  return reply({
    topic: "calls",
    intent: "diagnose",
    resolution: "escalate",
    messages: [text(t("mk.intro")), checkCard, text(t("mk.allGood"))],
    escalation: { allowed: true, subject: "Call problem" },
    summary,
  });
};

const accountStatus = async (ctx) => {
  const { user, t, text, card, row } = ctx;
  const [[statusRow], profile, deletion] = await Promise.all([
    sequelize.query("SELECT blocked FROM users WHERE id = :id LIMIT 1", {
      replacements: { id: user.id },
      type: QueryTypes.SELECT,
    }),
    User.findByPk(user.id, { attributes: ["publicUserId"] }),
    AccountDeletionRequest.findOne({ where: { userId: user.id, status: "pending" } }),
  ]);

  const blocked = Number(statusRow?.blocked) === 1;
  const accountCard = card(t("card.account"), [
    row(t("row.publicId"), profile?.publicUserId || "—"),
    row(
      t("row.status"),
      blocked ? t("val.restricted") : deletion ? t("val.deletionPending") : t("val.active"),
      blocked ? "danger" : deletion ? "warning" : "positive"
    ),
  ]);

  if (blocked) {
    return reply({
      topic: "account",
      intent: "status",
      resolution: "escalate",
      messages: [text(t("ma.restricted")), accountCard],
      escalation: { allowed: true, subject: "Account restricted — review request" },
      summary: [`Account blocked, public ID ${profile?.publicUserId || "n/a"}`],
    });
  }

  if (deletion) {
    return reply({
      topic: "account",
      intent: "status",
      resolution: "resolved",
      messages: [text(t("ma.deletionPending")), accountCard],
      escalation: { allowed: true, subject: "Account deletion request" },
      summary: [`Pending deletion request #${deletion.id}`],
    });
  }

  return reply({
    topic: "account",
    intent: "status",
    resolution: "resolved",
    messages: [text(t("ma.active")), accountCard],
    escalation: { allowed: true, subject: "Account question" },
  });
};

const referralBonus = async (ctx) => {
  const { user, t, text, date } = ctx;
  const status = await getMaleReferralStatus(user.id);

  if (status.applied) {
    return reply({
      topic: "referral",
      intent: "status",
      resolution: "resolved",
      messages: [
        text(t("mf.applied", { name: status.applied.referrerName, code: status.applied.code })),
        text(
          status.applied.status === "rewarded"
            ? t("mf.bonusPaid", { coins: status.applied.bonusCoins })
            : t("mf.bonusPending", { coins: status.applied.bonusCoins })
        ),
      ],
    });
  }

  return reply({
    topic: "referral",
    intent: "status",
    resolution: "resolved",
    messages: [
      text(
        status.eligible
          ? t("mf.canApply", { date: date(status.windowEndsAt), coins: status.maleBonusCoins })
          : t("mf.cannotApply")
      ),
    ],
  });
};

export const MEMBER_HANDLERS = {
  "recharge:status": rechargeStatus,
  "coins:charges": coinCharges,
  "calls:diagnose": callProblems,
  "account:status": accountStatus,
  "referral:status": referralBonus,
};
