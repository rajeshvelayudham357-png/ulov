import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";

// Withdrawal hours are configured and shown in India time. IST has no DST, so a
// fixed offset is exact.
export const WITHDRAW_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_NOTE_LENGTH = 300;

const DEFAULT_SETTINGS = {
  withdrawEnabled: true,
  disabledNote: "",
  timeRestrictionEnabled: false,
  unavailableFrom: "20:00",
  unavailableUntil: "08:00",
  timeRestrictionNote: "",
  holidayDays: [],
  holidayNote: "",
};

export const DEFAULT_DISABLED_NOTE =
  "Withdrawals are temporarily paused. Please check back later.";

let tableReady = false;

const ensureWithdrawSettingsTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_withdraw_settings (
id TINYINT NOT NULL PRIMARY KEY,
withdrawEnabled TINYINT(1) NOT NULL DEFAULT 1,
disabledNote VARCHAR(${MAX_NOTE_LENGTH}) NOT NULL DEFAULT '',
timeRestrictionEnabled TINYINT(1) NOT NULL DEFAULT 0,
unavailableFrom CHAR(5) NOT NULL DEFAULT '20:00',
unavailableUntil CHAR(5) NOT NULL DEFAULT '08:00',
timeRestrictionNote VARCHAR(${MAX_NOTE_LENGTH}) NOT NULL DEFAULT '',
holidayDays VARCHAR(32) NOT NULL DEFAULT '',
holidayNote VARCHAR(${MAX_NOTE_LENGTH}) NOT NULL DEFAULT '',
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  await sequelize.query(
    "INSERT IGNORE INTO admin_withdraw_settings (id) VALUES (1)"
  );

  tableReady = true;
};

const parseHolidayDays = (value) =>
  [...new Set(
    String(value || "")
      .split(",")
      .map((day) => Number(day.trim()))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  )].sort((a, b) => a - b);

const toMinutes = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
};

/** "20:00" -> "8:00 PM" */
export const formatTime12h = (time) => {
  const total = toMinutes(time);
  const hours24 = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
};

const formatDayList = (days) => {
  const names = days.map((day) => WEEKDAY_NAMES[day]);

  if (names.length <= 1) {
    return names.join("");
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

export const getWithdrawSettings = async () => {
  await ensureWithdrawSettingsTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_withdraw_settings WHERE id = 1 LIMIT 1",
    { type: QueryTypes.SELECT }
  );

  const row = rows[0] || {};

  return {
    withdrawEnabled:
      row.withdrawEnabled === undefined
        ? DEFAULT_SETTINGS.withdrawEnabled
        : Boolean(Number(row.withdrawEnabled)),
    disabledNote: row.disabledNote || "",
    timeRestrictionEnabled: Boolean(Number(row.timeRestrictionEnabled || 0)),
    unavailableFrom: TIME_PATTERN.test(row.unavailableFrom)
      ? row.unavailableFrom
      : DEFAULT_SETTINGS.unavailableFrom,
    unavailableUntil: TIME_PATTERN.test(row.unavailableUntil)
      ? row.unavailableUntil
      : DEFAULT_SETTINGS.unavailableUntil,
    timeRestrictionNote: row.timeRestrictionNote || "",
    holidayDays: parseHolidayDays(row.holidayDays),
    holidayNote: row.holidayNote || "",
    timezone: WITHDRAW_TIMEZONE,
    updatedAt: row.updatedAt || null,
  };
};

const normalizeNote = (value, label) => {
  const note = String(value ?? "").trim();

  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`${label} must be ${MAX_NOTE_LENGTH} characters or fewer`);
  }

  return note;
};

export const updateWithdrawSettings = async (payload = {}) => {
  const current = await getWithdrawSettings();

  const pick = (key) => (payload[key] !== undefined ? payload[key] : current[key]);

  const unavailableFrom = String(pick("unavailableFrom")).trim();
  const unavailableUntil = String(pick("unavailableUntil")).trim();

  if (!TIME_PATTERN.test(unavailableFrom) || !TIME_PATTERN.test(unavailableUntil)) {
    throw new Error("Times must be in 24-hour HH:MM format");
  }

  const timeRestrictionEnabled = Boolean(pick("timeRestrictionEnabled"));

  if (timeRestrictionEnabled && unavailableFrom === unavailableUntil) {
    throw new Error("Unavailable start and end time cannot be the same");
  }

  const rawDays = pick("holidayDays");
  const holidayDays = parseHolidayDays(
    Array.isArray(rawDays) ? rawDays.join(",") : rawDays
  );

  if (holidayDays.length === 7) {
    throw new Error(
      "All 7 days cannot be holidays. Turn off withdrawals instead."
    );
  }

  const next = {
    withdrawEnabled: Boolean(pick("withdrawEnabled")) ? 1 : 0,
    disabledNote: normalizeNote(pick("disabledNote"), "Disabled note"),
    timeRestrictionEnabled: timeRestrictionEnabled ? 1 : 0,
    unavailableFrom,
    unavailableUntil,
    timeRestrictionNote: normalizeNote(pick("timeRestrictionNote"), "Time restriction note"),
    holidayDays: holidayDays.join(","),
    holidayNote: normalizeNote(pick("holidayNote"), "Holiday note"),
  };

  await sequelize.query(
    `UPDATE admin_withdraw_settings
SET withdrawEnabled = :withdrawEnabled,
disabledNote = :disabledNote,
timeRestrictionEnabled = :timeRestrictionEnabled,
unavailableFrom = :unavailableFrom,
unavailableUntil = :unavailableUntil,
timeRestrictionNote = :timeRestrictionNote,
holidayDays = :holidayDays,
holidayNote = :holidayNote
WHERE id = 1`,
    { replacements: next }
  );

  return getWithdrawSettings();
};

/** Weekday (0 = Sunday) and minute-of-day in India time. */
const getLocalClock = (date) => {
  const local = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    weekday: local.getUTCDay(),
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
};

const isInTimeWindow = (minuteOfDay, from, until) => {
  const start = toMinutes(from);
  const end = toMinutes(until);

  if (start === end) {
    return false;
  }

  // Windows such as 20:00 -> 08:00 cross midnight.
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
};

const getBlockReason = (settings, date) => {
  if (!settings.withdrawEnabled) {
    return "disabled";
  }

  const { weekday, minuteOfDay } = getLocalClock(date);

  if (settings.holidayDays.includes(weekday)) {
    return "holiday";
  }

  if (
    settings.timeRestrictionEnabled &&
    isInTimeWindow(minuteOfDay, settings.unavailableFrom, settings.unavailableUntil)
  ) {
    return "time_window";
  }

  return null;
};

const findNextAvailableAt = (settings, now) => {
  if (!settings.withdrawEnabled) {
    return null;
  }

  const start = new Date(now);
  start.setUTCSeconds(0, 0);

  // At most 7 holiday days plus one time window; minute steps are exact.
  for (let minute = 1; minute <= 8 * 24 * 60; minute += 1) {
    const candidate = new Date(start.getTime() + minute * 60_000);

    if (!getBlockReason(settings, candidate)) {
      return candidate;
    }
  }

  return null;
};

const formatLocalDateTime = (date) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: WITHDRAW_TIMEZONE,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

const buildMessage = (reason, settings, nextAvailableAt) => {
  if (reason === "disabled") {
    return {
      title: "Withdrawals paused",
      message: settings.disabledNote || DEFAULT_DISABLED_NOTE,
    };
  }

  const reopen = nextAvailableAt
    ? ` You can request a withdrawal from ${formatLocalDateTime(nextAvailableAt)}.`
    : "";

  if (reason === "holiday") {
    return {
      title: "Withdrawal holiday",
      message:
        (settings.holidayNote ||
          `Withdrawals are not available on ${formatDayList(settings.holidayDays)}.`) +
        reopen,
    };
  }

  return {
    title: "Withdrawals closed now",
    message:
      (settings.timeRestrictionNote ||
        `Withdrawals are not available between ${formatTime12h(
          settings.unavailableFrom
        )} and ${formatTime12h(settings.unavailableUntil)}.`) + reopen,
  };
};

/**
 * Whether a female creator can request a withdrawal right now, and the note to
 * show when she cannot. Precedence: disabled, then holiday, then time window.
 */
export const getWithdrawAvailability = async ({ now = new Date(), settings } = {}) => {
  const resolved = settings || (await getWithdrawSettings());
  const reason = getBlockReason(resolved, now);
  const nextAvailableAt = reason ? findNextAvailableAt(resolved, now) : null;
  const { title, message } = reason
    ? buildMessage(reason, resolved, nextAvailableAt)
    : { title: null, message: null };

  return {
    available: !reason,
    reason,
    title,
    message,
    nextAvailableAt: nextAvailableAt ? nextAvailableAt.toISOString() : null,
    schedule: {
      timezone: WITHDRAW_TIMEZONE,
      timeRestrictionEnabled: resolved.timeRestrictionEnabled,
      unavailableFrom: resolved.unavailableFrom,
      unavailableUntil: resolved.unavailableUntil,
      holidayDays: resolved.holidayDays,
      holidayDayNames: resolved.holidayDays.map((day) => WEEKDAY_NAMES[day]),
    },
    serverTime: now.toISOString(),
  };
};

export class WithdrawUnavailableError extends Error {
  constructor(availability) {
    super(availability.message || DEFAULT_DISABLED_NOTE);
    this.name = "WithdrawUnavailableError";
    this.statusCode = 403;
    this.code = "WITHDRAW_UNAVAILABLE";
    this.availability = availability;
  }
}

export const assertWithdrawAvailableNow = async () => {
  const availability = await getWithdrawAvailability();

  if (!availability.available) {
    throw new WithdrawUnavailableError(availability);
  }

  return availability;
};
