/**
 * Creator support assistant: answers from real data and only allows tickets
 * when an issue can't be resolved automatically.
 *
 * Writes only rows with ids >= 887000 and removes them afterwards. Run against
 * a disposable schema, e.g. DB_NAME=ulov_billing_test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { sequelize } from "../../config/database.js";
import {
  CallHistory,
  Earning,
  Kyc,
  SupportMessage,
  SupportTicket,
  Withdraw,
} from "../../models/index.js";
import {
  askAssistant,
  detectSupportIntent,
  escalateToSupport,
  getAssistantWelcome,
} from "../supportAssistant.service.js";
import { SUPPORT_TRANSLATIONS } from "../../constants/supportAssistantI18n.js";
import { upsertTestUser } from "./helpers/qcTestHarness.js";

const CREATOR = 887001;
const MALE = 887002;
const IDS = [CREATOR, MALE];

const cleanup = async () => {
  const tickets = await SupportTicket.findAll({ where: { userId: IDS }, attributes: ["id"] });
  if (tickets.length) {
    await SupportMessage.destroy({ where: { ticketId: tickets.map((t) => t.id) } });
  }
  await SupportTicket.destroy({ where: { userId: IDS } });
  await Withdraw.destroy({ where: { userId: IDS } });
  await Kyc.destroy({ where: { userId: IDS } });
  const calls = await CallHistory.findAll({ where: { receiverId: CREATOR }, attributes: ["id"] });
  if (calls.length) {
    await Earning.destroy({ where: { callId: calls.map((c) => c.id) } });
  }
  await Earning.destroy({ where: { userId: IDS } });
  await CallHistory.destroy({ where: { receiverId: CREATOR } });
  await sequelize.query("DELETE FROM users WHERE id IN (:ids)", { replacements: { ids: IDS } });
};

const setUser = (fields) =>
  sequelize.query(
    `UPDATE users SET ${Object.keys(fields).map((k) => `${k} = :${k}`).join(", ")} WHERE id = :id`,
    { replacements: { ...fields, id: CREATOR } }
  );

const createWithdraw = async ({ status = "pending", hoursAgo = 1, amount = 500 }) => {
  const row = await Withdraw.create({ userId: CREATOR, amount, status, upiId: "ria@upi" });
  await sequelize.query(
    "UPDATE withdraws SET createdAt = DATE_SUB(UTC_TIMESTAMP(), INTERVAL :h HOUR), updatedAt = DATE_SUB(UTC_TIMESTAMP(), INTERVAL :h HOUR) WHERE id = :id",
    { replacements: { h: hoursAgo, id: row.id } }
  );
  return row;
};

const texts = (reply) =>
  reply.messages.map((m) => (m.type === "text" ? m.text : `${m.title}: ${m.rows.map((r) => `${r.label}=${r.value}`).join("; ")}`)).join("\n");

test.before(async () => {
  await cleanup();
  await upsertTestUser({ id: CREATOR, gender: "Female", nickname: "Ria" });
  await upsertTestUser({ id: MALE, gender: "Male", nickname: "Arun" });
  await setUser({ accountStatus: "approved", blocked: 0 });
});

test.after(async () => {
  await cleanup();
  await sequelize.close();
});

test("welcome greets creators by name with creator topics; men get member topics", async () => {
  const welcome = await getAssistantWelcome({ userId: CREATOR });
  assert.equal(welcome.audience, "creator");
  assert.match(welcome.greeting, /Hi Ria/);
  assert.ok(welcome.topics.some((t) => t.id === "withdrawal"));

  const member = await getAssistantWelcome({ userId: MALE });
  assert.equal(member.audience, "member");
  assert.ok(member.topics.some((t) => t.id === "recharge"));
  assert.ok(!member.topics.some((t) => t.id === "withdrawal"));
});

test("free text, including Thanglish, is routed to the right topic", () => {
  assert.deepEqual(detectSupportIntent("My withdrawal money not received"), { topic: "withdrawal", intent: "status" });
  assert.deepEqual(detectSupportIntent("panam varala"), { topic: "withdrawal", intent: "status" });
  assert.deepEqual(detectSupportIntent("withdraw rejected why"), { topic: "withdrawal", intent: "rejected" });
  assert.deepEqual(detectSupportIntent("call varala"), { topic: "calls", intent: "diagnose" });
  assert.deepEqual(detectSupportIntent("kyc pending"), { topic: "account", intent: "status" });
  assert.equal(detectSupportIntent("hello"), null);
});

test("a withdrawal inside its processing time gets an ETA and no ticket", async () => {
  await createWithdraw({ status: "pending", hoursAgo: 2 });

  const reply = await askAssistant({ userId: CREATOR, topic: "withdrawal" });
  assert.equal(reply.resolution, "wait");
  assert.equal(reply.escalation.allowed, false);
  assert.match(texts(reply), /processing time isn't over yet/);
  assert.match(texts(reply), /Expected by=/);

  await assert.rejects(
    () => escalateToSupport({ userId: CREATOR, topic: "withdrawal", intent: "status" }),
    /isn't needed yet/
  );
  assert.equal(await SupportTicket.count({ where: { userId: CREATOR } }), 0, "no noise ticket");

  await Withdraw.destroy({ where: { userId: CREATOR } });
});

test("a delayed withdrawal creates one prefilled ticket and reuses it", async () => {
  const delayed = await createWithdraw({ status: "pending", hoursAgo: 30, amount: 750 });

  const reply = await askAssistant({ userId: CREATOR, message: "my payout is not credited" });
  assert.equal(reply.topic, "withdrawal");
  assert.equal(reply.resolution, "escalate");
  assert.equal(reply.escalation.allowed, true);

  const first = await escalateToSupport({
    userId: CREATOR,
    topic: "withdrawal",
    intent: "status",
    details: "Please check",
  });
  assert.equal(first.existing, false);
  assert.match(first.ticket.subject, new RegExp(`^\\[Withdrawal\\] Withdrawal #${delayed.id} pending over 24 hours`));

  const message = await SupportMessage.findOne({ where: { ticketId: first.ticket.id } });
  assert.match(message.message, /Please check/);
  assert.match(message.message, /Assistant summary/);
  assert.match(message.message, /₹750/);

  const second = await escalateToSupport({ userId: CREATOR, topic: "withdrawal", intent: "status" });
  assert.equal(second.existing, true);
  assert.equal(second.ticket.id, first.ticket.id);
  assert.equal(await SupportTicket.count({ where: { userId: CREATOR } }), 1);

  await SupportTicket.update({ status: "closed" }, { where: { userId: CREATOR } });
  await Withdraw.destroy({ where: { userId: CREATOR } });
});

test("a rejected withdrawal explains the refund and allows a ticket", async () => {
  await createWithdraw({ status: "rejected", hoursAgo: 5, amount: 300 });
  const reply = await askAssistant({ userId: CREATOR, topic: "withdrawal", intent: "rejected" });
  assert.equal(reply.escalation.allowed, true);
  assert.match(texts(reply), /back in your available balance/);
  await Withdraw.destroy({ where: { userId: CREATOR } });
});

test("can't-withdraw lists the real blockers", async () => {
  const reply = await askAssistant({ userId: CREATOR, topic: "withdrawal", intent: "cannot_request" });
  const output = texts(reply);
  assert.match(output, /bank details aren't added/);
  assert.match(output, /below the minimum withdrawal/);
  assert.equal(reply.escalation.allowed, false);
});

test("account status covers review, rejection reasons and bank verification", async () => {
  await setUser({ accountStatus: "pending" });
  let reply = await askAssistant({ userId: CREATOR, topic: "account" });
  assert.equal(reply.resolution, "wait");
  assert.match(texts(reply), /under review/);

  await setUser({
    accountStatus: "rejected",
    rejectionReasons: JSON.stringify(["Poor lighting", "Voice not clear"]),
  });
  await Kyc.create({
    userId: CREATOR,
    accountName: "Ria",
    bankName: "Test Bank",
    accountNumber: "000111222333",
    ifsc: "TEST0000001",
    status: "rejected",
    rejectReason: "IFSC mismatch",
  });
  reply = await askAssistant({ userId: CREATOR, topic: "account" });
  const output = texts(reply);
  assert.match(output, /Poor lighting/);
  assert.match(output, /Voice not clear/);
  assert.match(output, /IFSC mismatch/);
  assert.equal(reply.escalation.allowed, true);

  await setUser({ accountStatus: "approved", rejectionReasons: null });
  await Kyc.destroy({ where: { userId: CREATOR } });
});

test("not-getting-calls points to the failing setting before allowing a ticket", async () => {
  await setUser({ online: 0, acceptVideoCalls: 0 });
  let reply = await askAssistant({ userId: CREATOR, topic: "calls" });
  assert.equal(reply.escalation.allowed, false);
  assert.match(texts(reply), /Turn on Online/);
  assert.match(texts(reply), /Video calls are switched off/);

  await setUser({ online: 1, acceptVideoCalls: 1, acceptVoiceCalls: 1 });
  reply = await askAssistant({ userId: CREATOR, topic: "calls" });
  assert.equal(reply.escalation.allowed, true);
});

test("calls without earnings are explained when the caller paid nothing", async () => {
  const unpaid = await CallHistory.create({
    callerId: MALE,
    receiverId: CREATOR,
    type: "video",
    status: "completed",
    duration: 95,
    coinsSpent: 0,
    collectedCoins: 0,
  });

  let reply = await askAssistant({ userId: CREATOR, topic: "earnings", intent: "missing_call" });
  assert.equal(reply.escalation.allowed, false);
  assert.match(texts(reply), /didn't have enough coins/);

  await unpaid.update({ collectedCoins: 60 });
  reply = await askAssistant({ userId: CREATOR, topic: "earnings", intent: "missing_call" });
  assert.equal(reply.escalation.allowed, true);
  assert.match(reply.escalation.subject, new RegExp(`#${unpaid.id}`));
});

test("every language has every message, with the same placeholders", () => {
  const base = SUPPORT_TRANSLATIONS.en;
  const placeholders = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const [code, table] of Object.entries(SUPPORT_TRANSLATIONS)) {
    for (const key of Object.keys(base)) {
      assert.ok(table[key], `${code} is missing ${key}`);
      assert.deepEqual(placeholders(table[key]), placeholders(base[key]), `${code} ${key} placeholders`);
    }
  }
});

test("language follows her first profile language, and can be changed", async () => {
  await setUser({ languages: JSON.stringify(["tamil", "english"]) });

  const tamil = await getAssistantWelcome({ userId: CREATOR });
  assert.equal(tamil.language, "ta");
  assert.match(tamil.greeting, /வணக்கம் Ria/);
  assert.equal(tamil.topics.find((topic) => topic.id === "withdrawal").title, "வித்ட்ரா");
  assert.equal(tamil.ui.createTicket, "டிக்கெட் உருவாக்கு");
  assert.equal(tamil.languages.length, 6);

  const hindi = await getAssistantWelcome({ userId: CREATOR, language: "hi" });
  assert.equal(hindi.language, "hi");
  assert.match(hindi.greeting, /नमस्ते Ria/);

  const unknown = await getAssistantWelcome({ userId: CREATOR, language: "xx" });
  assert.equal(unknown.language, "ta", "unsupported choice falls back to her profile language");

  await setUser({ languages: JSON.stringify(["marathi"]) });
  assert.equal((await getAssistantWelcome({ userId: CREATOR })).language, "en");

  await setUser({ languages: null });
});

test("answers are translated while tickets stay in English for the team", async () => {
  await createWithdraw({ status: "pending", hoursAgo: 2 });
  const waiting = await askAssistant({ userId: CREATOR, topic: "withdrawal", language: "ta" });
  assert.match(texts(waiting), /செயலாக்கத்தில்/);
  assert.match(waiting.escalation.reason, /24 மணி/);
  await assert.rejects(
    () => escalateToSupport({ userId: CREATOR, topic: "withdrawal", language: "ta" }),
    /டிக்கெட் தேவையில்லை/
  );
  await Withdraw.destroy({ where: { userId: CREATOR } });

  await createWithdraw({ status: "pending", hoursAgo: 30 });
  const created = await escalateToSupport({ userId: CREATOR, topic: "withdrawal", language: "hi", details: "कृपया देखें" });
  assert.match(created.ticket.subject, /^\[Withdrawal\] Withdrawal #\d+ pending over 24 hours/);
  const message = await SupportMessage.findOne({ where: { ticketId: created.ticket.id } });
  assert.match(message.message, /Creator's language: हिंदी/);
  assert.match(message.message, /Assistant summary/);

  await SupportTicket.update({ status: "closed" }, { where: { userId: CREATOR } });
  await Withdraw.destroy({ where: { userId: CREATOR } });
});

test("questions typed in native scripts are understood", () => {
  assert.equal(detectSupportIntent("என் பணம் வரவில்லை")?.topic, "withdrawal");
  assert.equal(detectSupportIntent("मेरा पैसा नहीं आया")?.topic, "withdrawal");
  assert.equal(detectSupportIntent("എന്റെ പണം കിട്ടിയില്ല")?.topic, "withdrawal");
  assert.equal(detectSupportIntent("నా డబ్బు రాలేదు")?.topic, "withdrawal");
  assert.equal(detectSupportIntent("ನನ್ನ ಹಣ ಬಂದಿಲ್ಲ")?.topic, "withdrawal");
  assert.equal(detectSupportIntent("आज की कमाई")?.topic, "earnings");
});

test("unrecognised messages and 'something else' can reach a human, but need details", async () => {
  const reply = await askAssistant({ userId: CREATOR, message: "hello there" });
  assert.equal(reply.topic, "other");
  assert.equal(reply.escalation.allowed, true);
  assert.ok(reply.suggestions.length >= 4);

  await assert.rejects(() => escalateToSupport({ userId: CREATOR, topic: "other" }), /describe your issue/);
  const created = await escalateToSupport({ userId: CREATOR, topic: "other", details: "Profile photo upload fails" });
  assert.match(created.ticket.subject, /^\[Something else\]/);
});
