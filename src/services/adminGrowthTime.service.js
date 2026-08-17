import {
  addIstDays,
  getRevenueAnalyticsPeriodBounds,
  istDateKeyToUtcRange,
  toIstDateKey,
} from "./adminRevenueTime.service.js";

export const GROWTH_TIMEZONE = "Asia/Kolkata (IST)";
export const MAX_GROWTH_RANGE_DAYS = 365;

export const GROWTH_PERIOD_PRESETS = [
  "today",
  "yesterday",
  "7d",
  "14d",
  "30d",
  "thisMonth",
  "custom",
];

const countInclusiveDays = (fromKey, toKey) => {
  const start = new Date(`${fromKey}T00:00:00+05:30`).getTime();
  const end = new Date(`${toKey}T00:00:00+05:30`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
};

export const getGrowthPeriodBounds = ({
  period = "7d",
  customFrom = "",
  customTo = "",
  now = new Date(),
} = {}) => {
  if (period === "14d") {
    const todayKey = toIstDateKey(now);
    const fromKey = addIstDays(todayKey, -13);
    return {
      fromUtc: istDateKeyToUtcRange(fromKey).start,
      toUtc: istDateKeyToUtcRange(todayKey).end,
      fromKey,
      toKey: todayKey,
      period: "14d",
      todayKey,
    };
  }

  const bounds = getRevenueAnalyticsPeriodBounds({
    period,
    customFrom,
    customTo,
    now,
  });

  const toKey =
    period === "custom" && customTo
      ? customTo
      : bounds.todayKey;

  let fromKey = bounds.todayKey;
  if (period === "today" || period === "yesterday") {
    fromKey =
      period === "yesterday"
        ? addIstDays(bounds.todayKey, -1)
        : bounds.todayKey;
  } else if (period === "7d") {
    fromKey = addIstDays(bounds.todayKey, -6);
  } else if (period === "30d") {
    fromKey = addIstDays(bounds.todayKey, -29);
  } else if (period === "thisMonth") {
    fromKey = `${bounds.todayKey.slice(0, 7)}-01`;
  } else if (period === "custom" && customFrom) {
    fromKey = customFrom;
  } else {
    fromKey = addIstDays(bounds.todayKey, -6);
  }

  return {
    fromUtc: bounds.fromUtc,
    toUtc: bounds.toUtc,
    fromKey,
    toKey,
    period,
    todayKey: bounds.todayKey,
  };
};

export const getPreviousPeriodBounds = ({ fromKey, toKey }) => {
  const dayCount = countInclusiveDays(fromKey, toKey);
  const previousToKey = addIstDays(fromKey, -1);
  const previousFromKey = addIstDays(fromKey, -dayCount);

  return {
    fromUtc: istDateKeyToUtcRange(previousFromKey).start,
    toUtc: istDateKeyToUtcRange(previousToKey).end,
    fromKey: previousFromKey,
    toKey: previousToKey,
    dayCount,
  };
};

export const validateGrowthDateRange = ({
  period = "7d",
  customFrom = "",
  customTo = "",
  now = new Date(),
}) => {
  const normalizedPeriod = String(period || "7d").trim();

  if (!GROWTH_PERIOD_PRESETS.includes(normalizedPeriod)) {
    return {
      valid: false,
      message: `Invalid period. Allowed: ${GROWTH_PERIOD_PRESETS.join(", ")}`,
    };
  }

  if (normalizedPeriod === "custom") {
    if (!customFrom || !customTo) {
      return {
        valid: false,
        message: "Custom period requires from and to (YYYY-MM-DD, IST).",
      };
    }

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(customFrom) || !datePattern.test(customTo)) {
      return {
        valid: false,
        message: "Custom dates must be YYYY-MM-DD.",
      };
    }

    if (customFrom > customTo) {
      return {
        valid: false,
        message: "from must be on or before to.",
      };
    }

    const days = countInclusiveDays(customFrom, customTo);
    if (days > MAX_GROWTH_RANGE_DAYS) {
      return {
        valid: false,
        message: `Date range cannot exceed ${MAX_GROWTH_RANGE_DAYS} days.`,
      };
    }
  }

  const current = getGrowthPeriodBounds({
    period: normalizedPeriod,
    customFrom,
    customTo,
    now,
  });

  const previous = getPreviousPeriodBounds(current);

  return {
    valid: true,
    current,
    previous,
    timezone: GROWTH_TIMEZONE,
  };
};

export const buildPeriodMeta = (validation) => ({
  timezone: GROWTH_TIMEZONE,
  period: validation.current.period,
  from: validation.current.fromKey,
  to: validation.current.toKey,
  previousFrom: validation.previous.fromKey,
  previousTo: validation.previous.toKey,
  dayCount: countInclusiveDays(
    validation.current.fromKey,
    validation.current.toKey
  ),
});
