/**
 * Admin withdrawal settings are stored, validated and enforced on
 * POST /api/withdraw/request. Restores the original settings afterwards.
 * Run against a disposable schema, e.g. DB_NAME=ulov_billing_test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { sequelize } from "../../config/database.js";
import { Withdraw } from "../../models/index.js";
import { requestWithdraw } from "../../controllers/withdraw.controller.js";
import {
  getWithdrawSettings,
  updateWithdrawSettings,
} from "../withdrawSettings.service.js";
import { createMockRes } from "./helpers/qcTestHarness.js";

const CREATOR = 884001;
let original;

test.before(async () => {
  original = await getWithdrawSettings();
});

test.after(async () => {
  await updateWithdrawSettings(original);
  await Withdraw.destroy({ where: { userId: CREATOR } });
  await sequelize.close();
});

test("settings round-trip and validation", async () => {
  const saved = await updateWithdrawSettings({
    withdrawEnabled: true,
    timeRestrictionEnabled: true,
    unavailableFrom: "20:00",
    unavailableUntil: "08:00",
    holidayDays: [0, 0, 6],
    holidayNote: "  Weekend off  ",
  });

  assert.equal(saved.timeRestrictionEnabled, true);
  assert.deepEqual(saved.holidayDays, [0, 6]);
  assert.equal(saved.holidayNote, "Weekend off");

  await assert.rejects(
    () => updateWithdrawSettings({ unavailableFrom: "25:00" }),
    /HH:MM/
  );
  await assert.rejects(
    () => updateWithdrawSettings({ unavailableFrom: "09:00", unavailableUntil: "09:00" }),
    /cannot be the same/
  );
  await assert.rejects(
    () => updateWithdrawSettings({ holidayDays: [0, 1, 2, 3, 4, 5, 6] }),
    /All 7 days/
  );
  await assert.rejects(
    () => updateWithdrawSettings({ disabledNote: "x".repeat(301) }),
    /300 characters/
  );
});

test("withdraw request is refused with the admin note while withdrawals are disabled", async () => {
  await updateWithdrawSettings({
    withdrawEnabled: false,
    disabledNote: "Payouts paused for bank maintenance.",
  });

  const res = createMockRes();
  await requestWithdraw(
    { body: { userId: CREATOR, amount: 500, payoutMethod: "upi", upiId: "x@upi" } },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "WITHDRAW_UNAVAILABLE");
  assert.equal(res.body.message, "Payouts paused for bank maintenance.");
  assert.equal(res.body.availability.reason, "disabled");
  assert.equal(await Withdraw.count({ where: { userId: CREATOR } }), 0);
});

test("once re-enabled, requests reach the normal checks again", async () => {
  await updateWithdrawSettings({
    withdrawEnabled: true,
    timeRestrictionEnabled: false,
    holidayDays: [],
  });

  const res = createMockRes();
  await requestWithdraw(
    { body: { userId: CREATOR, amount: 50, payoutMethod: "upi", upiId: "x@upi" } },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Minimum withdraw/);
});
