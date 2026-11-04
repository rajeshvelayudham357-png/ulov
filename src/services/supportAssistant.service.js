import { Op, QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  createTranslator,
  NATIVE_INTENT_WORDS,
  resolveSupportLanguage,
  SUPPORT_LANGUAGES,
  UI_KEYS,
} from "../constants/supportAssistantI18n.js";
import { CallHistory, Earning, Kyc, SupportTicket, User, Withdraw } from "../models/index.js";
import { createSupportTicket } from "./support.service.js";
import { getFemaleWithdrawSummary, MIN_FEMALE_WITHDRAW_AMOUNT } from "./withdraw.service.js";
import { getWithdrawAvailability } from "./withdrawSettings.service.js";
import { getFemaleReferralOverview } from "./referral.service.js";
import {
  createContext,
  englishDateTime,
  formatRupees,
  HOUR_MS,
  reply,
  startOfTodayIst,
} from "./supportAssistantShared.js";
import {
  detectMemberIntent,
  MEMBER_DEFAULT_INTENT,
  MEMBER_HANDLERS,
  MEMBER_TOPIC_DEFS,
} from "./supportAssistantMember.service.js";

/**
 * Support assistant. Answers common questions from the user's own data in her
 * or his language — creators (female) and members (male) get different
 * topics — and only offers a support ticket when the issue cannot be resolved
 * automatically. Ticket subjects and the summary for the support team stay
 * English.
 */

export const WITHDRAWAL_SLA_HOURS = 24;

const TOPIC_DEFS = [
  { id: "withdrawal", icon: "bank-transfer", category: "Withdrawal" },
  { id: "account", icon: "account-check-outline", category: "Account & verification" },
  { id: "earnings", icon: "cash-multiple", category: "Earnings & calls" },
  { id: "calls", icon: "phone-alert-outline", category: "Not getting calls" },
  { id: "referral", icon: "account-multiple-plus-outline", category: "Referral rewards" },
  { id: "other", icon: "chat-question-outline", category: "Something else" },
];

// Keyword intent detection, including common Thanglish / Hinglish phrasing and native scripts.
const INTENT_RULES = [
  { topic: "withdrawal", intent: "rejected", words: ["reject", "declin", "cancelled withdraw", "failed withdraw"] },
  { topic: "withdrawal", intent: "cannot_request", words: ["can't withdraw", "cannot withdraw", "unable to withdraw", "withdraw button", "not able to withdraw", "withdraw disabled", "withdraw panna mudiyala"] },
  { topic: "withdrawal", intent: "status", words: ["withdraw", "payout", "payment not received", "money not received", "not credited", "bank transfer", "upi", "panam", "paisa", "paise", "kasu", "amount varala", "settlement"] },
  { topic: "earnings", intent: "missing_call", words: ["call earning", "not added", "missing", "earning not", "coins not added", "earning varala"] },
  { topic: "earnings", intent: "today", words: ["earning", "earnings", "income", "coins", "gold", "kamai", "sambalam"] },
  { topic: "calls", intent: "diagnose", words: ["no call", "not getting call", "calls not coming", "call varala", "call nahi", "not receiving", "ring", "incoming"] },
  { topic: "account", intent: "status", words: ["account", "verify", "verification", "approval", "approved", "rejected profile", "blocked", "kyc", "bank detail", "bank verification", "profile review"] },
  { topic: "referral", intent: "status", words: ["referral", "refer", "invite", "code"] },
  ...NATIVE_INTENT_WORDS,
];

export const detectSupportIntent = (input) => {
  const value = String(input || "").toLowerCase();

  if (!value.trim()) {
    return null;
  }

  for (const rule of INTENT_RULES) {
    if (rule.words.some((word) => value.includes(word.toLowerCase()))) {
      return { topic: rule.topic, intent: rule.intent };
    }
  }

  return null;
};

const parseReasons = (value) => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(value)
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------

const withdrawalStatus = async (ctx) => {
  const { user, now, t, text, card, row, suggestion, dateTime, duration } = ctx;
  const latest = await Withdraw.findOne({
    where: { userId: user.id },
    order: [["createdAt", "DESC"]],
  });

  const followUps = [
    suggestion("withdrawal", "cannot_request", "s.cannotRequest"),
    suggestion("withdrawal", "rejected", "s.rejected"),
  ];

  if (!latest) {
    const summaryData = await getFemaleWithdrawSummary(user.id);
    return reply({
      topic: "withdrawal",
      intent: "status",
      resolution: "resolved",
      messages: [
        text(t("w.none")),
        card(t("card.balance"), [
          row(t("row.available"), formatRupees(summaryData.availableBalance), "positive"),
          row(t("row.minWithdrawal"), formatRupees(MIN_FEMALE_WITHDRAW_AMOUNT)),
        ]),
        text(t("w.requestFromScreen")),
      ],
      suggestions: followUps,
    });
  }

  const requestedAt = new Date(latest.createdAt);
  const elapsed = now.getTime() - requestedAt.getTime();
  const dueAt = new Date(requestedAt.getTime() + WITHDRAWAL_SLA_HOURS * HOUR_MS);
  const details = [
    row(t("row.amount"), formatRupees(latest.amount)),
    row(t("row.requested"), dateTime(requestedAt)),
    row(t("row.method"), latest.upiId ? t("val.upi") : t("val.bank")),
  ];
  const title = t("card.withdrawal", { id: latest.id });

  if (latest.status === "approved") {
    const sinceProcessed = now.getTime() - new Date(latest.updatedAt).getTime();
    const overdue = sinceProcessed > WITHDRAWAL_SLA_HOURS * HOUR_MS;

    return reply({
      topic: "withdrawal",
      intent: "status",
      resolution: "resolved",
      messages: [
        text(t("w.processed")),
        card(title, [...details, row(t("row.processed"), dateTime(latest.updatedAt), "positive")], "positive"),
        text(t("w.transferDelay")),
      ],
      escalation: overdue
        ? { allowed: true, subject: `Withdrawal #${latest.id} processed but not received` }
        : { allowed: false, reason: t("reason.transferWindow") },
      suggestions: followUps,
      summary: [
        `Withdrawal #${latest.id} ${formatRupees(latest.amount)} approved ${englishDateTime(latest.updatedAt)}, creator reports not received`,
      ],
    });
  }

  if (latest.status === "rejected") {
    return withdrawalRejected(ctx, latest);
  }

  if (elapsed < WITHDRAWAL_SLA_HOURS * HOUR_MS) {
    return reply({
      topic: "withdrawal",
      intent: "status",
      resolution: "wait",
      messages: [
        text(t("w.processing", { ago: duration(elapsed) })),
        card(
          title,
          [
            ...details,
            row(t("row.status"), t("val.processing"), "warning"),
            row(t("row.expectedBy"), dateTime(dueAt), "positive"),
          ],
          "warning"
        ),
        text(t("w.processingInfo", { due: dateTime(dueAt) })),
      ],
      escalation: {
        allowed: false,
        reason: t("reason.withinSla"),
        availableAt: dueAt.toISOString(),
      },
      suggestions: followUps,
    });
  }

  return reply({
    topic: "withdrawal",
    intent: "status",
    resolution: "escalate",
    messages: [
      text(t("w.delayed")),
      card(
        title,
        [
          ...details,
          row(t("row.status"), t("val.delayed"), "danger"),
          row(t("row.waitingFor"), duration(elapsed), "danger"),
        ],
        "danger"
      ),
      text(t("w.ticketPrepared")),
    ],
    escalation: {
      allowed: true,
      subject: `Withdrawal #${latest.id} pending over ${WITHDRAWAL_SLA_HOURS} hours`,
    },
    suggestions: followUps,
    summary: [
      `Withdrawal #${latest.id}: ${formatRupees(latest.amount)}, ${latest.upiId ? "UPI" : "bank"}`,
      `Requested ${englishDateTime(requestedAt)} (${Math.round(elapsed / HOUR_MS)} h ago), still pending`,
    ],
  });
};

const withdrawalRejected = async (ctx, knownLatest = null) => {
  const { user, t, text, card, row, suggestion, dateTime, kycLabel } = ctx;
  const latest =
    knownLatest ||
    (await Withdraw.findOne({
      where: { userId: user.id, status: "rejected" },
      order: [["updatedAt", "DESC"]],
    }));

  if (!latest) {
    return reply({
      topic: "withdrawal",
      intent: "rejected",
      resolution: "resolved",
      messages: [text(t("w.noneRejected"))],
      suggestions: [suggestion("withdrawal", "status", "s.whereIs")],
    });
  }

  const kyc = await Kyc.findOne({ where: { userId: user.id } });

  return reply({
    topic: "withdrawal",
    intent: "rejected",
    resolution: "escalate",
    messages: [
      text(t("w.rejectedRefund")),
      card(
        t("card.withdrawal", { id: latest.id }),
        [
          row(t("row.amount"), formatRupees(latest.amount)),
          row(t("row.requested"), dateTime(latest.createdAt)),
          row(t("row.rejected"), dateTime(latest.updatedAt), "danger"),
          row(t("row.bankVerification"), kycLabel(kyc), kyc?.status === "approved" ? "positive" : "warning"),
        ],
        "danger"
      ),
      text(t("w.rejectedTips")),
    ],
    escalation: { allowed: true, subject: `Withdrawal #${latest.id} rejected — reason needed` },
    suggestions: [suggestion("account", "status", "s.checkBank")],
    summary: [
      `Withdrawal #${latest.id}: ${formatRupees(latest.amount)} rejected ${englishDateTime(latest.updatedAt)}`,
      `KYC status: ${kyc?.status || "not submitted"}`,
    ],
  });
};

const withdrawalCannotRequest = async (ctx) => {
  const { user, t, text, card, row, suggestion, kycLabel } = ctx;
  const [availability, summaryData, kyc] = await Promise.all([
    getWithdrawAvailability(),
    getFemaleWithdrawSummary(user.id),
    Kyc.findOne({ where: { userId: user.id } }),
  ]);

  const blockers = [];

  if (!availability.available) {
    // Admin-configured note (written by the team in the admin panel).
    blockers.push(`🕒 ${availability.message}`);
  }

  if (!kyc || kyc.status !== "approved") {
    blockers.push(
      !kyc
        ? t("w.blockNoKyc")
        : kyc.status === "pending"
          ? t("w.blockKycPending")
          : `${t("w.blockKycRejected")}${kyc.rejectReason ? ` (${kyc.rejectReason})` : ""}`
    );
  }

  if (summaryData.availableBalance < MIN_FEMALE_WITHDRAW_AMOUNT) {
    blockers.push(
      t("w.blockLowBalance", {
        balance: formatRupees(summaryData.availableBalance),
        min: formatRupees(MIN_FEMALE_WITHDRAW_AMOUNT),
      })
    );
  }

  if (summaryData.pendingAmount > 0) {
    blockers.push(t("w.blockPending", { amount: formatRupees(summaryData.pendingAmount) }));
  }

  const balanceCard = card(t("card.balance"), [
    row(t("row.availableShort"), formatRupees(summaryData.availableBalance), "positive"),
    row(t("row.pendingWithdrawals"), formatRupees(summaryData.pendingAmount)),
    row(t("row.bankVerification"), kycLabel(kyc), kyc?.status === "approved" ? "positive" : "warning"),
  ]);

  if (blockers.length) {
    return reply({
      topic: "withdrawal",
      intent: "cannot_request",
      resolution: "resolved",
      messages: [text(t("w.blockersIntro")), ...blockers.map(text), balanceCard],
      suggestions: [suggestion("withdrawal", "status", "s.whereIs")],
    });
  }

  return reply({
    topic: "withdrawal",
    intent: "cannot_request",
    resolution: "escalate",
    messages: [text(t("w.allGood")), balanceCard, text(t("w.retry"))],
    escalation: { allowed: true, subject: "Unable to request a withdrawal" },
    summary: [
      `Available ${formatRupees(summaryData.availableBalance)}, pending ${formatRupees(summaryData.pendingAmount)}, KYC approved, withdrawals open`,
    ],
  });
};

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

const accountStatus = async (ctx) => {
  const { user, t, text, card, row, suggestion, kycLabel } = ctx;
  const [statusRow] = await sequelize.query(
    "SELECT accountStatus, rejectionReasons, blocked FROM users WHERE id = :id LIMIT 1",
    { replacements: { id: user.id }, type: QueryTypes.SELECT }
  );
  const kyc = await Kyc.findOne({ where: { userId: user.id } });
  const status = String(statusRow?.accountStatus || "pending").toLowerCase();
  const blocked = Number(statusRow?.blocked) === 1;
  const messages = [];
  let resolution = "resolved";
  let escalation = { allowed: false };

  if (blocked) {
    messages.push(text(t("a.restricted")));
    resolution = "escalate";
    escalation = { allowed: true, subject: "Account restricted — review request" };
  } else if (status === "approved") {
    messages.push(text(t("a.approved")));
  } else if (status === "rejected") {
    const reasons = parseReasons(statusRow?.rejectionReasons);
    messages.push(text(t("a.rejectedIntro")));
    messages.push(
      card(
        t("card.reviewFeedback"),
        (reasons.length ? reasons : [t("a.defaultReason")]).map((reason) => row("•", reason, "danger")),
        "danger"
      )
    );
    messages.push(text(t("a.resubmit")));
    escalation = { allowed: true, subject: "Profile verification rejected — need help" };
  } else {
    messages.push(text(t("a.underReview")));
    resolution = "wait";
  }

  messages.push(
    card(t("card.bankVerification"), [
      row(
        t("row.status"),
        kycLabel(kyc),
        kyc?.status === "approved" ? "positive" : kyc?.status === "rejected" ? "danger" : "warning"
      ),
      ...(kyc?.status === "rejected" && kyc.rejectReason ? [row(t("row.reason"), kyc.rejectReason, "danger")] : []),
    ])
  );

  if (!kyc) {
    messages.push(text(t("a.addBank")));
  } else if (kyc.status === "pending") {
    messages.push(text(t("a.bankPending")));
  }

  return reply({
    topic: "account",
    intent: "status",
    resolution,
    messages,
    escalation,
    suggestions: [
      suggestion("withdrawal", "cannot_request", "s.whyCantWithdraw"),
      suggestion("calls", "diagnose", "s.notGettingCalls"),
    ],
    summary: [
      `Account status: ${blocked ? "blocked" : status}`,
      `KYC: ${kyc?.status || "not submitted"}`,
    ],
  });
};

// ---------------------------------------------------------------------------
// Earnings & calls
// ---------------------------------------------------------------------------

const recentCallsWithEarnings = async (userId, since) => {
  const calls = await CallHistory.findAll({
    where: {
      receiverId: userId,
      status: "completed",
      createdAt: { [Op.gte]: since },
    },
    order: [["createdAt", "DESC"]],
    limit: 5,
  });

  const earnings = calls.length
    ? await Earning.findAll({ where: { callId: calls.map((c) => c.id) } })
    : [];
  const byCall = new Map(earnings.map((e) => [Number(e.callId), e]));

  return calls.map((call) => ({ call, earning: byCall.get(Number(call.id)) || null }));
};

const callTypeLabel = (t, type) =>
  ["voice", "audio"].includes(String(type).toLowerCase()) ? t("val.voice") : t("val.video");

const earningsToday = async (ctx) => {
  const { user, now, t, text, card, row, suggestion, dateTime } = ctx;
  const since = startOfTodayIst(now);
  const [todayAmount, todayCoins, calls, summaryData] = await Promise.all([
    Earning.sum("amount", { where: { userId: user.id, createdAt: { [Op.gte]: since } } }),
    Earning.sum("coins", { where: { userId: user.id, createdAt: { [Op.gte]: since } } }),
    recentCallsWithEarnings(user.id, new Date(now.getTime() - 24 * HOUR_MS)),
    getFemaleWithdrawSummary(user.id),
  ]);

  return reply({
    topic: "earnings",
    intent: "today",
    resolution: "resolved",
    messages: [
      text(t("e.snapshot")),
      card(
        t("card.today"),
        [
          row(t("row.earnedToday"), formatRupees(todayAmount), "positive"),
          row(t("row.coinsToday"), Number(todayCoins || 0).toLocaleString("en-IN")),
          row(t("row.available"), formatRupees(summaryData.availableBalance), "positive"),
        ],
        "positive"
      ),
      ...(calls.length
        ? [
            card(
              t("card.recentCalls"),
              calls.map(({ call, earning }) =>
                row(
                  t("row.callLabel", {
                    time: dateTime(call.createdAt),
                    minutes: Math.round(Number(call.duration || 0) / 60),
                    type: callTypeLabel(t, call.type),
                  }),
                  earning ? formatRupees(earning.amount) : "₹0",
                  earning ? "positive" : "warning"
                )
              )
            ),
          ]
        : []),
      text(t("e.howEarn")),
    ],
    suggestions: [suggestion("earnings", "missing_call", "s.missingEarning")],
  });
};

const earningsMissingCall = async (ctx) => {
  const { user, now, t, text, card, row, suggestion, dateTime } = ctx;
  const calls = await recentCallsWithEarnings(user.id, new Date(now.getTime() - 48 * HOUR_MS));
  const unpaid = calls.filter(({ call, earning }) => !earning && Number(call.duration || 0) > 0);

  if (!calls.length) {
    return reply({
      topic: "earnings",
      intent: "missing_call",
      resolution: "resolved",
      messages: [text(t("e.noCalls"))],
      suggestions: [suggestion("calls", "diagnose", "s.notGettingCalls")],
    });
  }

  if (!unpaid.length) {
    return reply({
      topic: "earnings",
      intent: "missing_call",
      resolution: "resolved",
      messages: [
        text(t("e.allPaid")),
        card(
          t("card.recentCalls"),
          calls.map(({ call, earning }) =>
            row(`${dateTime(call.createdAt)} · ${callTypeLabel(t, call.type)}`, formatRupees(earning?.amount), "positive")
          ),
          "positive"
        ),
      ],
      escalation: { allowed: true, subject: "Call earning looks incorrect" },
      summary: calls.map(({ call, earning }) => `Call #${call.id}: ${formatRupees(earning?.amount)}`),
    });
  }

  const noCoins = unpaid.filter(({ call }) => Number(call.collectedCoins || 0) === 0);
  const allExplained = noCoins.length === unpaid.length;

  return reply({
    topic: "earnings",
    intent: "missing_call",
    resolution: allExplained ? "resolved" : "escalate",
    messages: [
      text(t("e.foundUnpaid", { count: unpaid.length })),
      card(
        t("card.callsWithoutEarnings"),
        unpaid.map(({ call }) =>
          row(
            `#${call.id} · ${dateTime(call.createdAt)}`,
            Number(call.collectedCoins || 0) === 0 ? t("val.callerPaidZero") : t("val.underReview"),
            "warning"
          )
        ),
        "warning"
      ),
      text(allExplained ? t("e.unpaidExplained") : t("e.someUnpaid")),
    ],
    escalation: {
      allowed: !allExplained,
      subject: `Missing earnings for call${unpaid.length > 1 ? "s" : ""} ${unpaid.map(({ call }) => `#${call.id}`).join(", ")}`,
    },
    summary: unpaid.map(
      ({ call }) =>
        `Call #${call.id} ${englishDateTime(call.createdAt)}, ${call.duration}s, collected ${call.collectedCoins ?? "n/a"} coins, no earning`
    ),
  });
};

// ---------------------------------------------------------------------------
// Calls not arriving
// ---------------------------------------------------------------------------

const callsDiagnose = async (ctx) => {
  const { user, t, text, card, row } = ctx;
  const [statusRow] = await sequelize.query(
    `SELECT online, accountStatus, blocked, acceptVoiceCalls, acceptVideoCalls
     FROM users WHERE id = :id LIMIT 1`,
    { replacements: { id: user.id }, type: QueryTypes.SELECT }
  );

  const checks = [
    { key: "approved", ok: String(statusRow?.accountStatus || "").toLowerCase() === "approved" },
    { key: "active", ok: Number(statusRow?.blocked) !== 1 },
    { key: "online", ok: Boolean(Number(statusRow?.online)) },
    { key: "voice", ok: Boolean(Number(statusRow?.acceptVoiceCalls ?? 1)) },
    { key: "video", ok: Boolean(Number(statusRow?.acceptVideoCalls ?? 1)) },
  ];

  const failing = checks.filter((check) => !check.ok);

  return reply({
    topic: "calls",
    intent: "diagnose",
    resolution: failing.length ? "resolved" : "escalate",
    messages: [
      text(t("c.intro")),
      card(
        t("card.callReadiness"),
        checks.map((check) => row(t(`c.check.${check.key}`), check.ok ? "✓" : "✗", check.ok ? "positive" : "danger")),
        failing.length ? "warning" : "positive"
      ),
      ...(failing.length
        ? failing.map((check) => text(`👉 ${t(`c.fix.${check.key}`)}`))
        : [text(t("c.allGood"))]),
    ],
    escalation: { allowed: failing.length === 0, subject: "Not receiving calls" },
    summary: checks.map((check) => `${check.key}: ${check.ok ? "yes" : "no"}`),
  });
};

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------

const referralStatus = async (ctx) => {
  const { user, t, text, card, row } = ctx;
  const overview = await getFemaleReferralOverview({ userId: user.id });

  return reply({
    topic: "referral",
    intent: "status",
    resolution: "resolved",
    messages: [
      text(t("r.code", { code: overview.code })),
      card(t("card.referrals"), [
        row(t("row.invited"), overview.stats.total),
        row(t("row.rewarded"), overview.stats.rewarded, "positive"),
        row(t("row.waitingRecharge"), overview.stats.pending, "warning"),
        row(t("row.earned"), formatRupees(overview.stats.earned), "positive"),
      ]),
      text(t("r.explain", { amount: formatRupees(overview.rewards.creatorRewardAmount) })),
    ],
  });
};

// ---------------------------------------------------------------------------

const HANDLERS = {
  "withdrawal:status": withdrawalStatus,
  "withdrawal:rejected": (ctx) => withdrawalRejected(ctx),
  "withdrawal:cannot_request": withdrawalCannotRequest,
  "account:status": accountStatus,
  "earnings:today": earningsToday,
  "earnings:missing_call": earningsMissingCall,
  "calls:diagnose": callsDiagnose,
  "referral:status": referralStatus,
};

const DEFAULT_INTENT = {
  withdrawal: "status",
  account: "status",
  earnings: "today",
  calls: "diagnose",
  referral: "status",
};

const AUDIENCES = {
  creator: {
    topicDefs: TOPIC_DEFS,
    handlers: HANDLERS,
    defaultIntent: DEFAULT_INTENT,
    detect: detectSupportIntent,
    topicKey: (id) => `topic.${id}`,
    prompt: "prompt",
    nameFallback: "nameFallback",
    label: "Creator",
  },
  member: {
    topicDefs: MEMBER_TOPIC_DEFS,
    handlers: MEMBER_HANDLERS,
    defaultIntent: MEMBER_DEFAULT_INTENT,
    detect: detectMemberIntent,
    topicKey: (id) => `m.topic.${id}`,
    prompt: "m.prompt",
    nameFallback: "nameFallbackMember",
    label: "Member",
  },
};

const loadUser = async (userId, requestedLanguage) => {
  const user = await User.findByPk(userId, {
    attributes: ["id", "gender", "nickname", "name", "username", "languages"],
  });

  if (!user) {
    const t = createTranslator(resolveSupportLanguage({ requested: requestedLanguage }));
    const error = new Error(t("ui.error"));
    error.statusCode = 404;
    throw error;
  }

  const language = resolveSupportLanguage({
    requested: requestedLanguage,
    profileLanguages: user.languages,
  });
  const audience = String(user.gender).toLowerCase() === "female" ? "creator" : "member";

  return { user, language, audience, config: AUDIENCES[audience] };
};

export const getAssistantWelcome = async ({ userId, language: requested }) => {
  const { user, language, audience, config } = await loadUser(userId, requested);
  const t = createTranslator(language);
  const name =
    user.nickname ||
    (user.name && user.name !== "New User" ? user.name : null) ||
    user.username ||
    t(config.nameFallback);

  return {
    audience,
    language,
    languages: SUPPORT_LANGUAGES.map(({ code, label }) => ({ code, label })),
    greeting: t("greeting", { name }),
    prompt: t(config.prompt),
    topics: config.topicDefs.map((topic) => ({
      id: topic.id,
      icon: topic.icon,
      title: t(`${config.topicKey(topic.id)}.title`),
      description: t(`${config.topicKey(topic.id)}.description`),
    })),
    ui: Object.fromEntries(UI_KEYS.map((key) => [key.slice(3), t(key)])),
  };
};

/** Answers a topic/intent (or free text) from the user's own data. */
export const askAssistant = async ({
  userId,
  topic,
  intent,
  message,
  language: requested,
  now = new Date(),
  deps = {},
}) => {
  const { user, language, config } = await loadUser(userId, requested);
  const ctx = createContext({ user, now, language, deps });
  const { t, text, suggestion } = ctx;
  const categories = Object.fromEntries(config.topicDefs.map((def) => [def.id, def.category]));
  let resolvedTopic = topic;
  let resolvedIntent = intent;

  if (!resolvedTopic && message) {
    const detected = config.detect(message);

    if (!detected) {
      return reply({
        topic: "other",
        intent: "unknown",
        resolution: "escalate",
        messages: [text(t("o.notUnderstood"))],
        escalation: { allowed: true, subject: "Help request" },
        suggestions: config.topicDefs
          .filter((def) => def.id !== "other")
          .map((def) => suggestion(def.id, config.defaultIntent[def.id], `${config.topicKey(def.id)}.title`)),
        summary: [`${config.label} wrote: "${String(message).slice(0, 300)}"`],
      });
    }

    resolvedTopic = detected.topic;
    resolvedIntent = detected.intent;
  }

  if (resolvedTopic === "other" || !categories[resolvedTopic]) {
    return reply({
      topic: "other",
      intent: "free",
      resolution: "escalate",
      messages: [text(t("o.free"))],
      escalation: { allowed: true, subject: "Help request" },
    });
  }

  const handler =
    config.handlers[`${resolvedTopic}:${resolvedIntent}`] ||
    config.handlers[`${resolvedTopic}:${config.defaultIntent[resolvedTopic]}`];

  return handler(ctx);
};

const OPEN_STATUSES = ["open", "answered"];

/**
 * Creates a ticket only when the assistant allows it for this issue, and
 * reuses an open ticket on the same topic instead of creating a duplicate.
 */
export const escalateToSupport = async ({
  userId,
  topic,
  intent,
  details,
  language: requested,
  now = new Date(),
  deps = {},
}) => {
  const diagnosis = await askAssistant({ userId, topic, intent, language: requested, now, deps });
  const { language, config } = await loadUser(userId, requested);
  const t = createTranslator(language);

  if (!diagnosis.escalation?.allowed) {
    const error = new Error(
      diagnosis.escalation?.reason
        ? t("err.ticketNotNeeded", { reason: diagnosis.escalation.reason })
        : t("err.noTicketNeeded")
    );
    error.statusCode = 409;
    error.availableAt = diagnosis.escalation?.availableAt ?? null;
    throw error;
  }

  const category =
    config.topicDefs.find((def) => def.id === diagnosis.topic)?.category || "Support";
  const prefix = `[${category}]`;

  const existing = await SupportTicket.findOne({
    where: {
      userId,
      status: { [Op.in]: OPEN_STATUSES },
      subject: { [Op.like]: `${prefix}%` },
    },
    order: [["updatedAt", "DESC"]],
  });

  if (existing) {
    return { ticket: { id: existing.id, subject: existing.subject, status: existing.status }, existing: true };
  }

  const note = String(details || "").trim();

  if (diagnosis.topic === "other" && !note) {
    const error = new Error(t("err.describe"));
    error.statusCode = 400;
    throw error;
  }

  const languageLabel = SUPPORT_LANGUAGES.find((item) => item.code === language)?.label || "English";

  const message = [
    note || "(No extra details added)",
    "",
    "— Assistant summary —",
    `Topic: ${category}`,
    `${config.label}'s language: ${languageLabel}`,
    ...(diagnosis.summary || []),
  ].join("\n");

  const ticket = await createSupportTicket({
    userId,
    subject: `${prefix} ${diagnosis.escalation.subject || "Help request"}`.slice(0, 250),
    message,
  });

  return { ticket, existing: false };
};
