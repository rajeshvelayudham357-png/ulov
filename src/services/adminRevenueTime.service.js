const IST_OFFSET_MINUTES = 330;

export const toIstDateKey = (date = new Date()) => {
  const shifted = new Date(
    date.getTime() + IST_OFFSET_MINUTES * 60 * 1000
  );

  return shifted.toISOString().slice(0, 10);
};

export const istDateKeyToUtcRange = (dateKey) => ({
  start: new Date(`${dateKey}T00:00:00+05:30`),
  end: new Date(`${dateKey}T23:59:59.999+05:30`),
});

export const addIstDays = (dateKey, days) => {
  const anchor = new Date(`${dateKey}T00:00:00+05:30`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return toIstDateKey(anchor);
};

export const getIstMonthStartUtc = (dateKey) => {
  const [year, month] = String(dateKey).split("-").map(Number);
  return new Date(
    `${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`
  );
};

export const getIstYearStartUtc = (dateKey) => {
  const year = Number(String(dateKey).split("-")[0]);
  return new Date(`${year}-01-01T00:00:00+05:30`);
};

export const getRevenueAnalyticsPeriodBounds = ({
  period = "30d",
  customFrom = "",
  customTo = "",
  now = new Date(),
} = {}) => {
  const todayKey = toIstDateKey(now);

  if (period === "today") {
    const { start, end } = istDateKeyToUtcRange(todayKey);
    return { fromUtc: start, toUtc: end, todayKey };
  }

  if (period === "yesterday") {
    const yesterdayKey = addIstDays(todayKey, -1);
    const { start, end } = istDateKeyToUtcRange(yesterdayKey);
    return { fromUtc: start, toUtc: end, todayKey };
  }

  if (period === "7d") {
    const fromKey = addIstDays(todayKey, -6);
    return {
      fromUtc: istDateKeyToUtcRange(fromKey).start,
      toUtc: istDateKeyToUtcRange(todayKey).end,
      todayKey,
    };
  }

  if (period === "30d") {
    const fromKey = addIstDays(todayKey, -29);
    return {
      fromUtc: istDateKeyToUtcRange(fromKey).start,
      toUtc: istDateKeyToUtcRange(todayKey).end,
      todayKey,
    };
  }

  if (period === "thisMonth") {
    const monthStart = getIstMonthStartUtc(todayKey);
    return {
      fromUtc: monthStart,
      toUtc: istDateKeyToUtcRange(todayKey).end,
      todayKey,
    };
  }

  if (period === "lastMonth") {
    const thisMonthStart = getIstMonthStartUtc(todayKey);
    const lastMonthAnchor = new Date(thisMonthStart);
    lastMonthAnchor.setUTCDate(lastMonthAnchor.getUTCDate() - 1);
    const lastMonthKey = toIstDateKey(lastMonthAnchor);
    return {
      fromUtc: getIstMonthStartUtc(lastMonthKey),
      toUtc: istDateKeyToUtcRange(lastMonthKey).end,
      todayKey,
    };
  }

  if (period === "thisYear") {
    return {
      fromUtc: getIstYearStartUtc(todayKey),
      toUtc: istDateKeyToUtcRange(todayKey).end,
      todayKey,
    };
  }

  if (period === "custom" && customFrom && customTo) {
    return {
      fromUtc: istDateKeyToUtcRange(customFrom).start,
      toUtc: istDateKeyToUtcRange(customTo).end,
      todayKey,
    };
  }

  const fromKey = addIstDays(todayKey, -29);
  return {
    fromUtc: istDateKeyToUtcRange(fromKey).start,
    toUtc: istDateKeyToUtcRange(todayKey).end,
    todayKey,
  };
};

/** MySQL expression: calendar date in IST for a UTC datetime column. */
export const IST_DATE_SQL = "DATE(DATE_ADD(updatedAt, INTERVAL 330 MINUTE))";
