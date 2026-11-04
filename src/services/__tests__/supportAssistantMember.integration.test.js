/**
 * Support assistant for male members: recharges (with gateway re-check),
 * coin charges, call problems, account and referral bonus.
 *
 * Writes only rows with ids >= 888000 and removes them afterwards. Run against
 * a disposable schema, e.g. DB_NAME=ulov_billing_test. Payment gateways are
 * stubbed; nothing external is called.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { sequelize } from "../../config/database.js";
import {
  AccountDeletionRequest,
  CallHistory,
  PaymentOrder,
  SupportMessage,
  SupportTicket,
  Wallet,
  WalletTransaction,
} from "../../models/index.js";
import { askAssistant, escalateToSupport, getAssistantWelcome } from "../supportAssistant.service.js";
import { detectMemberIntent } from "../supportAssistantMember.service.js";
import { creditWalletForPayment } from "../payment.service.js";
import { getInitialCallCharge } from "../callSettlement.service.js";
import { upsertTestUser, upsertTestWallet } from "./helpers/qcTestHarness.js";

const MALE = 888001;
const CREATOR = 888002;
const IDS = [MALE, CREATOR];

const cleanup = async () => {
  const tickets = await SupportTicket.findAll({ where: { userId: IDS }, attributes: ["id"] });
  if (tickets.length) {
    await SupportMessage.destroy({ where: { ticketId: tickets.map((t) => t.id) } });
  }
  await SupportTicket.destroy({ where: { userId: IDS } });
  await AccountDeletionRequest.destroy({ where: { userId: IDS } });
  await PaymentOrder.destroy({ where: { userId: IDS } });
  await WalletTransaction.destroy({ where: { userId: IDS } });
  await CallHistory.destroy({ where: { callerId: MALE } });
  await Wallet.destroy({ where: { userId: IDS } });
  await sequelize.query("DELETE FROM users WHERE id IN (:ids)", { replacements: { ids: IDS } });
};

const setUser = (fields) =>
  sequelize.query(
    `UPDATE users SET ${Object.keys(fields).map((k) => `${k} = :${k}`).join(", ")} WHERE id = :id`,
    { replacements: { ...fields, id: MALE } }
  );

const createOrder = async ({ status = "CREATED", minutesAgo = 1, gateway = "razorpay", amount = 99, coins = 120 }) => {
  const order = await PaymentOrder.create({
    orderId: `SA_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: MALE,
    coins,
    amount,
    gateway,
    status,
  });
  await sequelize.query(
    "UPDATE payment_orders SET createdAt = DATE_SUB(UTC_TIMESTAMP(), INTERVAL :m MINUTE) WHERE id = :id",
    { replacements: { m: minutesAgo, id: order.id } }
  );
  return order;
};

const texts = (reply) =>
  reply.messages
    .map((m) => (m.type === "text" ? m.text : `${m.title}: ${m.rows.map((r) => `${r.label}=${r.value}`).join("; ")}`))
    .join("\n");

const balanceOf = async () => Number((await Wallet.findOne({ where: { userId: MALE } }))?.balance ?? 0);

test.before(async () => {
  await cleanup();
  await upsertTestUser({ id: MALE, gender: "Male", nickname: "Arun" });
  await upsertTestUser({ id: CREATOR, gender: "Female", nickname: "Ria" });
  await upsertTestWallet(MALE, 0);
  await setUser({ blocked: 0, languages: null });
});

test.after(async () => {
  await cleanup();
  await sequelize.close();
});

test("men get member topics in their language", async () => {
  const welcome = await getAssistantWelcome({ userId: MALE });
  assert.equal(welcome.audience, "member");
  assert.match(welcome.greeting, /Hi Arun/);
  assert.deepEqual(
    welcome.topics.map((t) => t.id),
    ["recharge", "coins", "calls", "account", "referral", "other"]
  );

  await setUser({ languages: JSON.stringify(["tamil"]) });
  const tamil = await getAssistantWelcome({ userId: MALE });
  assert.equal(tamil.language, "ta");
  assert.equal(tamil.topics[0].title, "ரீசார்ஜ் & பேமெண்ட்");
  await setUser({ languages: null });
});

test("free text is routed to member topics", () => {
  assert.equal(detectMemberIntent("payment done but coins not added")?.topic, "recharge");
  assert.equal(detectMemberIntent("panam pochu coins varala")?.topic, "recharge");
  assert.equal(detectMemberIntent("मेरा रिचार्ज नहीं हुआ")?.topic, "recharge");
  assert.equal(detectMemberIntent("my call got cut")?.topic, "calls");
  assert.equal(detectMemberIntent("why coins deducted")?.topic, "coins");
  assert.equal(detectMemberIntent("account blocked")?.topic, "account");
});

test("no recent recharge shows the wallet", async () => {
  const reply = await askAssistant({ userId: MALE, topic: "recharge" });
  assert.equal(reply.resolution, "resolved");
  assert.match(texts(reply), /couldn't find any recharge/);
});

test("a payment confirmed moments ago is not ticketed", async () => {
  await createOrder({ minutesAgo: 0 });
  const reply = await askAssistant({ userId: MALE, topic: "recharge" });
  assert.equal(reply.resolution, "wait");
  assert.equal(reply.escalation.allowed, false);
  await assert.rejects(() => escalateToSupport({ userId: MALE, topic: "recharge" }), /isn't needed yet/);
  await PaymentOrder.destroy({ where: { userId: MALE } });
});

test("an unconfirmed payment is re-checked with the gateway and credited", async () => {
  const order = await createOrder({ minutesAgo: 10, coins: 150 });
  const before = await balanceOf();

  const syncOrder = async (orderId) => {
    assert.equal(orderId, order.orderId);
    const fresh = await PaymentOrder.findOne({ where: { orderId } });
    const result = await creditWalletForPayment(fresh, { paymentMethod: "test" });
    return { credited: !result.alreadyPaid };
  };

  const reply = await askAssistant({ userId: MALE, topic: "recharge", deps: { syncOrder } });
  assert.equal(reply.resolution, "resolved");
  assert.match(texts(reply), /re-checked with the payment provider/);
  assert.equal(await balanceOf(), before + 150);

  await PaymentOrder.destroy({ where: { userId: MALE } });
});

test("a payment still unconfirmed after 30 minutes becomes a prefilled ticket", async () => {
  const stillPending = async () => ({ credited: false });

  await createOrder({ minutesAgo: 10 });
  let reply = await askAssistant({ userId: MALE, topic: "recharge", deps: { syncOrder: stillPending } });
  assert.equal(reply.resolution, "wait");
  assert.equal(reply.escalation.allowed, false);
  await PaymentOrder.destroy({ where: { userId: MALE } });

  const order = await createOrder({ minutesAgo: 45 });
  reply = await askAssistant({ userId: MALE, topic: "recharge", deps: { syncOrder: stillPending } });
  assert.equal(reply.resolution, "escalate");
  assert.equal(reply.escalation.allowed, true);

  const created = await escalateToSupport({
    userId: MALE,
    topic: "recharge",
    details: "Money debited from GPay",
    deps: { syncOrder: stillPending },
  });
  assert.equal(created.ticket.subject, `[Recharge & payments] Recharge order ${order.orderId} not confirmed`);
  const message = await SupportMessage.findOne({ where: { ticketId: created.ticket.id } });
  assert.match(message.message, /Money debited from GPay/);
  assert.match(message.message, /Member's language: English/);
  assert.match(message.message, new RegExp(order.orderId));

  await SupportTicket.update({ status: "closed" }, { where: { userId: MALE } });
  await PaymentOrder.destroy({ where: { userId: MALE } });
});

test("failed payments explain the bank refund window before allowing a ticket", async () => {
  await createOrder({ status: "FAILED", minutesAgo: 60 * 24 });
  let reply = await askAssistant({ userId: MALE, topic: "recharge" });
  assert.match(texts(reply), /5–7 working days/);
  assert.equal(reply.escalation.allowed, false);
  await PaymentOrder.destroy({ where: { userId: MALE } });

  await createOrder({ status: "FAILED", minutesAgo: 60 * 24 * 8 });
  reply = await askAssistant({ userId: MALE, topic: "recharge" });
  assert.equal(reply.escalation.allowed, true);
  assert.match(texts(reply), /more than 7 days/);
  await PaymentOrder.destroy({ where: { userId: MALE } });
});

test("a successful recharge is confirmed", async () => {
  await createOrder({ status: "PAID", minutesAgo: 30, amount: 199, coins: 250 });
  const reply = await askAssistant({ userId: MALE, topic: "recharge" });
  assert.equal(reply.resolution, "resolved");
  assert.match(texts(reply), /added 250 coins/);
  await PaymentOrder.destroy({ where: { userId: MALE } });
});

test("coin charges list recent calls and flag a charge for a call that never connected", async () => {
  const answered = await CallHistory.create({
    callerId: MALE,
    receiverId: CREATOR,
    type: "voice",
    status: "completed",
    duration: 130,
    coinsSpent: 60,
    acceptedAt: new Date(Date.now() - 200_000),
  });
  await WalletTransaction.create({
    userId: MALE, type: "debit", amount: 60, description: "Call charge", referenceType: "call", referenceId: answered.id,
  });

  // A 4-second answered video call pays its first half-minute; that is not an error.
  const short = await CallHistory.create({
    callerId: MALE,
    receiverId: CREATOR,
    type: "video",
    status: "completed",
    duration: 4,
    acceptedAt: new Date(Date.now() - 10_000),
  });
  await WalletTransaction.create({
    userId: MALE, type: "debit", amount: 30, description: "Call charge", referenceType: "call", referenceId: short.id,
  });

  let reply = await askAssistant({ userId: MALE, topic: "coins" });
  assert.equal(reply.resolution, "resolved");
  assert.match(texts(reply), /60 coins/);
  assert.doesNotMatch(texts(reply), /didn't connect properly/);

  const ghost = await CallHistory.create({
    callerId: MALE, receiverId: CREATOR, type: "video", status: "completed", duration: 0, coinsSpent: 0,
  });
  await WalletTransaction.create({
    userId: MALE, type: "debit", amount: 30, description: "Call charge", referenceType: "call", referenceId: ghost.id,
  });

  reply = await askAssistant({ userId: MALE, topic: "coins" });
  assert.equal(reply.resolution, "escalate");
  assert.match(reply.escalation.subject, new RegExp(`#${ghost.id}`));
  assert.match(texts(reply), /didn't connect properly/);

  await WalletTransaction.destroy({ where: { userId: MALE } });
  await CallHistory.destroy({ where: { callerId: MALE } });
});

test("call problems: low balance, coins ran out, and restricted accounts", async () => {
  await upsertTestWallet(MALE, 0);
  let reply = await askAssistant({ userId: MALE, topic: "calls" });
  const minimum = Math.min(await getInitialCallCharge({ type: "voice" }), await getInitialCallCharge({ type: "video" }));
  assert.match(texts(reply), new RegExp(`at least ${minimum} coins`));
  assert.equal(reply.escalation.allowed, false);

  await upsertTestWallet(MALE, 1000);
  await CallHistory.create({
    callerId: MALE, receiverId: CREATOR, type: "video", status: "completed", duration: 90,
    acceptedAt: new Date(Date.now() - 120_000), endReason: "insufficient_balance",
  });
  reply = await askAssistant({ userId: MALE, topic: "calls" });
  assert.match(texts(reply), /coins ran out/);

  await setUser({ blocked: 1 });
  reply = await askAssistant({ userId: MALE, topic: "calls" });
  assert.equal(reply.escalation.allowed, true);
  assert.match(texts(reply), /restricted/);
  await setUser({ blocked: 0 });
  await CallHistory.destroy({ where: { callerId: MALE } });
});

test("account shows status and a pending deletion request", async () => {
  let reply = await askAssistant({ userId: MALE, topic: "account" });
  assert.match(texts(reply), /active/);

  await AccountDeletionRequest.create({ userId: MALE, status: "pending", reason: "test" });
  reply = await askAssistant({ userId: MALE, topic: "account" });
  assert.match(texts(reply), /requested account deletion/);
  await AccountDeletionRequest.destroy({ where: { userId: MALE } });
});

test("referral bonus explains whether he can still enter a code", async () => {
  const reply = await askAssistant({ userId: MALE, topic: "referral" });
  assert.equal(reply.resolution, "resolved");
  assert.match(texts(reply), /referral code|Referral codes/);
});

test("answers come back in Hindi for a Hindi request", async () => {
  await createOrder({ status: "FAILED", minutesAgo: 60 });
  const reply = await askAssistant({ userId: MALE, topic: "recharge", language: "hi" });
  assert.match(texts(reply), /बैंक/);
  await PaymentOrder.destroy({ where: { userId: MALE } });
});
