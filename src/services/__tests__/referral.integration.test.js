/**
 * Female referral program: codes, applying, eligibility rules, one-time
 * rewards on the first real payment, withdrawable balance and admin listing.
 *
 * Writes only rows with ids >= 886000 and removes them afterwards. Run against
 * a disposable schema, e.g. DB_NAME=ulov_billing_test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { QueryTypes } from "sequelize";

import { sequelize } from "../../config/database.js";
import { PaymentOrder, Wallet, WalletTransaction } from "../../models/index.js";
import {
  applyReferralCode,
  ensureReferralSchema,
  getFemaleReferralOverview,
  getMaleReferralStatus,
  getReferralSettings,
  listReferralsForAdmin,
  processReferralQualifyingPayment,
  updateReferralSettings,
} from "../referral.service.js";
import { creditWalletForPayment } from "../payment.service.js";
import { getFemaleWithdrawSummary } from "../withdraw.service.js";
import { upsertTestUser, upsertTestWallet } from "./helpers/qcTestHarness.js";

const PREFIX = 886000;
const CREATOR = PREFIX + 1;
const MALE = PREFIX + 2;
const MALE_TWO = PREFIX + 3;
const OLD_MALE = PREFIX + 4;
const PAID_MALE = PREFIX + 5;
const BLOCKED_CREATOR = PREFIX + 6;
const MALE_THREE = PREFIX + 7;
const IDS = [CREATOR, MALE, MALE_TWO, OLD_MALE, PAID_MALE, BLOCKED_CREATOR, MALE_THREE];

let originalSettings;

const cleanup = async () => {
  await ensureReferralSchema();
  await sequelize.query("DELETE FROM referrals WHERE referrerId IN (:ids) OR referredUserId IN (:ids)", {
    replacements: { ids: IDS },
  });
  await sequelize.query("DELETE FROM referral_codes WHERE userId IN (:ids)", { replacements: { ids: IDS } });
  await PaymentOrder.destroy({ where: { userId: IDS } });
  await WalletTransaction.destroy({ where: { userId: IDS } });
  await Wallet.destroy({ where: { userId: IDS } });
  await sequelize.query("DELETE FROM users WHERE id IN (:ids)", { replacements: { ids: IDS } });
};

const balanceOf = async (userId) => Number((await Wallet.findOne({ where: { userId } }))?.balance ?? 0);

const referralOf = async (userId) => {
  const [row] = await sequelize.query("SELECT * FROM referrals WHERE referredUserId = :userId", {
    replacements: { userId },
    type: QueryTypes.SELECT,
  });
  return row;
};

const createPaidOrder = async ({ userId, gateway = "razorpay", amount = 99, coins = 100 }) => {
  const order = await PaymentOrder.create({
    orderId: `REF_TEST_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId,
    coins,
    amount,
    gateway,
    status: "CREATED",
  });
  return creditWalletForPayment(order, { paymentMethod: "test" });
};

test.before(async () => {
  await cleanup();
  originalSettings = await getReferralSettings();
  await updateReferralSettings({
    enabled: true,
    femaleRewardAmount: 50,
    maleBonusCoins: 40,
    entryWindowDays: 7,
    minQualifyingAmount: 0,
  });

  await upsertTestUser({ id: CREATOR, gender: "Female", nickname: "Ref Creator" });
  await upsertTestUser({ id: BLOCKED_CREATOR, gender: "Female", nickname: "Blocked Creator" });
  // `blocked` is a users column the model does not declare; admin blocking writes it directly.
  await sequelize.query("UPDATE users SET blocked = 1 WHERE id = :id", {
    replacements: { id: BLOCKED_CREATOR },
  });
  for (const id of [MALE, MALE_TWO, OLD_MALE, PAID_MALE, MALE_THREE]) {
    await upsertTestUser({ id, gender: "Male", nickname: `Ref Male ${id}` });
    await upsertTestWallet(id, 0);
  }
  await sequelize.query("UPDATE users SET createdAt = DATE_SUB(NOW(), INTERVAL 10 DAY) WHERE id = :id", {
    replacements: { id: OLD_MALE },
  });
});

test.after(async () => {
  await cleanup();
  await updateReferralSettings(originalSettings);
  await sequelize.close();
});

test("a creator gets one stable code and an overview", async () => {
  const first = await getFemaleReferralOverview({ userId: CREATOR });
  const second = await getFemaleReferralOverview({ userId: CREATOR });

  assert.match(first.code, /^UL[A-Z2-9]{6}$/);
  assert.equal(second.code, first.code);
  assert.equal(first.enabled, true);
  assert.equal(first.rewards.creatorRewardAmount, 50);
  assert.equal(first.rewards.maleBonusCoins, 40);
  assert.deepEqual(first.stats, { total: 0, rewarded: 0, pending: 0, earned: 0 });

  await assert.rejects(() => getFemaleReferralOverview({ userId: MALE }), /for creators/);
});

test("a new male can apply a code once; invalid and ineligible cases are refused", async () => {
  const { code } = await getFemaleReferralOverview({ userId: CREATOR });

  assert.equal((await getMaleReferralStatus(MALE)).eligible, true);
  await assert.rejects(() => applyReferralCode({ userId: MALE, code: "ULNOPE99" }), /not valid/);

  const applied = await applyReferralCode({ userId: MALE, code: ` ${code.toLowerCase()} ` });
  assert.equal(applied.bonusCoins, 40);
  assert.equal(applied.referrerName, "Ref Creator");

  const status = await getMaleReferralStatus(MALE);
  assert.equal(status.eligible, false);
  assert.equal(status.applied.code, code);
  assert.equal(status.applied.status, "joined");

  await assert.rejects(() => applyReferralCode({ userId: MALE, code }), /already used/);
  await assert.rejects(() => applyReferralCode({ userId: OLD_MALE, code }), /first days after joining/);

  await createPaidOrder({ userId: PAID_MALE });
  await assert.rejects(() => applyReferralCode({ userId: PAID_MALE, code }), /before your first recharge/);

  const blocked = await getFemaleReferralOverview({ userId: BLOCKED_CREATOR });
  await assert.rejects(() => applyReferralCode({ userId: MALE_TWO, code: blocked.code }), /not active/);

  await updateReferralSettings({ enabled: false });
  await assert.rejects(() => applyReferralCode({ userId: MALE_TWO, code }), /not available/);
  await updateReferralSettings({ enabled: true });
});

test("the first real payment rewards both sides exactly once", async () => {
  const before = await getFemaleWithdrawSummary(CREATOR);

  const payment = await createPaidOrder({ userId: MALE, coins: 100 });
  assert.equal(payment.alreadyPaid, false);
  assert.equal(await balanceOf(MALE), 100 + 40, "recharge plus referral bonus");

  const referral = await referralOf(MALE);
  assert.equal(referral.status, "rewarded");
  assert.ok(referral.rewardedAt);
  assert.equal(referral.paymentOrderId, payment.paymentOrder.orderId);

  const bonusTx = await WalletTransaction.findAll({
    where: { userId: MALE, referenceType: "referral" },
  });
  assert.equal(bonusTx.length, 1);
  assert.equal(Number(bonusTx[0].amount), 40);

  const after = await getFemaleWithdrawSummary(CREATOR);
  assert.equal(after.totalEarned - before.totalEarned, 50);
  assert.equal(after.availableBalance - before.availableBalance, 50);

  // A second payment and a repeated reward call change nothing.
  await createPaidOrder({ userId: MALE, coins: 100 });
  assert.equal(await processReferralQualifyingPayment({ userId: MALE, paymentOrderId: "x", amount: 99 }), null);
  assert.equal(await balanceOf(MALE), 240);
  assert.equal((await getFemaleWithdrawSummary(CREATOR)).totalEarned, after.totalEarned);

  const overview = await getFemaleReferralOverview({ userId: CREATOR });
  assert.equal(overview.stats.rewarded, 1);
  assert.equal(overview.stats.earned, 50);
  assert.equal(overview.referrals[0].user.name, `Ref Male ${MALE}`);
  assert.equal(overview.referrals[0].rewardAmount, 50);
});

test("concurrent payment callbacks reward once", async () => {
  const { code } = await getFemaleReferralOverview({ userId: CREATOR });
  await applyReferralCode({ userId: MALE_TWO, code });

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      processReferralQualifyingPayment({ userId: MALE_TWO, paymentOrderId: "concurrent", amount: 99 })
    )
  );

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await balanceOf(MALE_TWO), 40);
});

test("admin credits never qualify, and amounts promised at apply time are honored", async () => {
  const { code } = await getFemaleReferralOverview({ userId: CREATOR });
  await applyReferralCode({ userId: MALE_THREE, code });

  // Settings change after he applied: he keeps the 40-coin / ₹50 promise.
  await updateReferralSettings({ femaleRewardAmount: 10, maleBonusCoins: 5, minQualifyingAmount: 50 });

  await createPaidOrder({ userId: MALE_THREE, gateway: "admin", amount: 500, coins: 500 });
  assert.equal((await referralOf(MALE_THREE)).status, "joined", "admin credit ignored");

  await createPaidOrder({ userId: MALE_THREE, amount: 49, coins: 50 });
  assert.equal((await referralOf(MALE_THREE)).status, "joined", "below the minimum qualifying amount");

  await createPaidOrder({ userId: MALE_THREE, amount: 99, coins: 100 });
  const referral = await referralOf(MALE_THREE);
  assert.equal(referral.status, "rewarded");
  assert.equal(Number(referral.femaleRewardAmount), 50);
  assert.equal(Number(referral.maleBonusCoins), 40);
  assert.equal(await balanceOf(MALE_THREE), 500 + 50 + 100 + 40);

  await updateReferralSettings({ femaleRewardAmount: 50, maleBonusCoins: 40, minQualifyingAmount: 0 });
});

test("settings are validated", async () => {
  await assert.rejects(() => updateReferralSettings({ femaleRewardAmount: -1 }), /between/);
  await assert.rejects(() => updateReferralSettings({ maleBonusCoins: 1.5e9 }), /between/);
  await assert.rejects(() => updateReferralSettings({ entryWindowDays: 400 }), /between/);
});

test("admin listing shows referrals with totals and filters", async () => {
  const all = await listReferralsForAdmin({ search: "Ref Creator" });
  assert.ok(all.summary.total >= 3);
  assert.ok(all.referrals.every((row) => row.referrer.id === CREATOR));

  const rewarded = await listReferralsForAdmin({ status: "rewarded", search: "Ref Creator" });
  assert.ok(rewarded.referrals.every((row) => row.status === "rewarded"));
  assert.equal(rewarded.summary.creatorRewards, rewarded.summary.rewarded * 50);
});
