import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DISABLED_NOTE,
  formatTime12h,
  getWithdrawAvailability,
} from "../withdrawSettings.service.js";

const baseSettings = {
  withdrawEnabled: true,
  disabledNote: "",
  timeRestrictionEnabled: false,
  unavailableFrom: "20:00",
  unavailableUntil: "08:00",
  timeRestrictionNote: "",
  holidayDays: [],
  holidayNote: "",
};

// 2026-11-04 is a Wednesday; 2026-11-08 is a Sunday. Times are IST (+05:30).
const ist = (isoLocal) => new Date(`${isoLocal}+05:30`);

const check = (overrides, at) =>
  getWithdrawAvailability({ settings: { ...baseSettings, ...overrides }, now: ist(at) });

test("withdrawals are open when nothing restricts them", async () => {
  const result = await check({}, "2026-11-04T23:30:00");
  assert.equal(result.available, true);
  assert.equal(result.reason, null);
  assert.equal(result.message, null);
});

test("admin switch disables withdrawals with the admin note or a default note", async () => {
  const custom = await check(
    { withdrawEnabled: false, disabledNote: "Bank maintenance until Friday." },
    "2026-11-04T12:00:00"
  );
  assert.equal(custom.available, false);
  assert.equal(custom.reason, "disabled");
  assert.equal(custom.message, "Bank maintenance until Friday.");
  assert.equal(custom.nextAvailableAt, null);

  const fallback = await check({ withdrawEnabled: false }, "2026-11-04T12:00:00");
  assert.equal(fallback.message, DEFAULT_DISABLED_NOTE);
});

test("overnight 8 PM to 8 AM window blocks withdrawals and reports the reopen time", async () => {
  const settings = { timeRestrictionEnabled: true };

  const evening = await check(settings, "2026-11-04T21:15:00");
  assert.equal(evening.available, false);
  assert.equal(evening.reason, "time_window");
  assert.equal(evening.nextAvailableAt, ist("2026-11-05T08:00:00").toISOString());
  assert.match(evening.message, /between 8:00 PM and 8:00 AM/);

  assert.equal((await check(settings, "2026-11-05T07:59:00")).available, false);
  assert.equal((await check(settings, "2026-11-05T08:00:00")).available, true);
  assert.equal((await check(settings, "2026-11-05T19:59:00")).available, true);
  assert.equal((await check(settings, "2026-11-05T20:00:00")).available, false);
});

test("same-day windows work too", async () => {
  const settings = {
    timeRestrictionEnabled: true,
    unavailableFrom: "13:00",
    unavailableUntil: "14:30",
  };
  assert.equal((await check(settings, "2026-11-04T12:59:00")).available, true);
  assert.equal((await check(settings, "2026-11-04T13:00:00")).available, false);
  assert.equal((await check(settings, "2026-11-04T14:30:00")).available, true);
});

test("time window is ignored while the time restriction is switched off", async () => {
  const result = await check({ timeRestrictionEnabled: false }, "2026-11-04T22:00:00");
  assert.equal(result.available, true);
});

test("Sunday holiday blocks the whole day", async () => {
  const sunday = await check({ holidayDays: [0] }, "2026-11-08T12:00:00");
  assert.equal(sunday.available, false);
  assert.equal(sunday.reason, "holiday");
  assert.match(sunday.message, /not available on Sunday/);
  assert.equal(sunday.nextAvailableAt, ist("2026-11-09T00:00:00").toISOString());

  assert.equal((await check({ holidayDays: [0] }, "2026-11-07T23:59:00")).available, true);
});

test("holiday and night window combine: Saturday night reopens Monday 8 AM", async () => {
  const settings = { holidayDays: [0], timeRestrictionEnabled: true };

  const saturdayNight = await check(settings, "2026-11-07T21:00:00");
  assert.equal(saturdayNight.reason, "time_window");
  assert.equal(saturdayNight.nextAvailableAt, ist("2026-11-09T08:00:00").toISOString());

  const sunday = await check(settings, "2026-11-08T10:00:00");
  assert.equal(sunday.reason, "holiday", "holiday wins over the time window");
  assert.equal(sunday.nextAvailableAt, ist("2026-11-09T08:00:00").toISOString());
});

test("admin notes replace the generated text and keep the reopen time", async () => {
  const result = await check(
    { holidayDays: [0], holidayNote: "Payout team is off on Sundays." },
    "2026-11-08T10:00:00"
  );
  assert.match(result.message, /^Payout team is off on Sundays\./);
  assert.match(result.message, /You can request a withdrawal from Monday/);
});

test("12-hour time formatting", () => {
  assert.equal(formatTime12h("00:00"), "12:00 AM");
  assert.equal(formatTime12h("08:05"), "8:05 AM");
  assert.equal(formatTime12h("12:00"), "12:00 PM");
  assert.equal(formatTime12h("20:00"), "8:00 PM");
});
