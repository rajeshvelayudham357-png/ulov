/**
 * IST day / Night Owl window helpers for male task eligibility.
 * Asia/Kolkata has no DST (fixed UTC+05:30).
 */
export const MALE_TASK_TIME_ZONE = "Asia/Kolkata";
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const getIndiaDateKey = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: MALE_TASK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

/** Inclusive start / exclusive end Instant for an IST calendar day. */
export const getIstDayBounds = (dateKey) => {
  const start = new Date(`${dateKey}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
};

/** Night Owl window [21:00, 24:00) IST for the given evening date. */
export const getNightOwlWindowBounds = (
  dateKey,
  { startHour = 21, endHour = 24 } = {}
) => {
  const dayStart = new Date(`${dateKey}T00:00:00+05:30`);
  const start = new Date(dayStart.getTime() + startHour * 60 * 60 * 1000);
  const end = new Date(dayStart.getTime() + endHour * 60 * 60 * 1000);
  return { start, end };
};

/** Previous IST calendar date key (YYYY-MM-DD). */
export const getPreviousIndiaDateKey = (dateKey) => {
  const { start } = getIstDayBounds(dateKey);
  return getIndiaDateKey(new Date(start.getTime() - 60 * 1000));
};

/** Milliseconds until next IST midnight from `now`. */
export const getMsUntilIstMidnight = (now = new Date()) => {
  const today = getIndiaDateKey(now);
  const { end } = getIstDayBounds(today);
  return Math.max(0, end.getTime() - now.getTime());
};

/**
 * Connected seconds of [acceptedAt, endedAt] that fall inside [windowStart, windowEnd).
 */
export const clipSecondsToWindow = (acceptedAt, endedAt, windowStart, windowEnd) => {
  const acceptMs = new Date(acceptedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const winStart = new Date(windowStart).getTime();
  const winEnd = new Date(windowEnd).getTime();

  if (
    !Number.isFinite(acceptMs) ||
    !Number.isFinite(endMs) ||
    !Number.isFinite(winStart) ||
    !Number.isFinite(winEnd) ||
    endMs <= acceptMs ||
    winEnd <= winStart
  ) {
    return 0;
  }

  const start = Math.max(acceptMs, winStart);
  const end = Math.min(endMs, winEnd);
  return Math.max(0, Math.floor((end - start) / 1000));
};

export const isVideoCallType = (type) => {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();
  return normalized === "video";
};

export const normalizeCallType = (type) => {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();
  if (normalized === "audio" || normalized === "voice") {
    return "voice";
  }
  if (normalized === "video") {
    return "video";
  }
  return normalized || "voice";
};
