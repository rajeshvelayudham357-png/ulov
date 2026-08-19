export const DEFAULT_CALL_RATE_SETTINGS = {
  voiceRatePerMinute: 60,
  videoRatePerMinute: 60,
  femaleEarningPercentage: 50,
};

export const toPositiveNumber = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : fallback;

export const clampPercentage = (value, fallback) => {
  const parsed = Number(value);
  const base = Number.isFinite(parsed) ? parsed : Number(fallback);
  const safe = Number.isFinite(base) ? base : 0;
  return Math.min(100, Math.max(0, safe));
};

export const parseOptionalRate = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const resolveEffectiveRate = (customRate, globalRate, fallback) => {
  const custom = parseOptionalRate(customRate);

  if (custom !== null) {
    return custom;
  }

  return toPositiveNumber(globalRate, fallback);
};

export const computeMaleCallCost = ({
  durationSeconds,
  type,
  ratePerMinute,
}) => {
  const normalizedType = String(type ?? "video").toLowerCase();
  const isVoice = normalizedType === "audio" || normalizedType === "voice";
  const safeDuration = Math.max(0, Number(durationSeconds) || 0);
  const safeRate = toPositiveNumber(ratePerMinute, 0);
  const VIDEO_FIRST_HALF_SECONDS = 30;

  if (safeDuration <= 0) {
    return { minutes: 0, maleCost: 0, type: isVoice ? "voice" : "video" };
  }

  if (!isVoice && safeDuration <= VIDEO_FIRST_HALF_SECONDS) {
    return {
      minutes: 0.5,
      maleCost: Math.max(1, Math.ceil(safeRate / 2)),
      type: "video",
    };
  }

  const minutes = Math.max(1, Math.ceil(safeDuration / 60));
  return {
    minutes,
    maleCost: Math.ceil(minutes * safeRate),
    type: isVoice ? "voice" : "video",
  };
};

export const computeCreatorEarnings = ({
  maleCost,
  coinValue,
  creatorPercentage,
}) => {
  const safeCoins = Math.max(0, Number(maleCost) || 0);
  const safeCoinValue = Number(coinValue) > 0 ? Number(coinValue) : 0;
  const safePercent = clampPercentage(creatorPercentage, 0);
  const revenue = Number((safeCoins * safeCoinValue).toFixed(2));
  const femaleAmount = Number((revenue * (safePercent / 100)).toFixed(2));
  const platformAmount = Number((revenue - femaleAmount).toFixed(2));
  const femaleEarn = Math.floor(safeCoins * (safePercent / 100));

  return {
    revenue,
    femaleAmount,
    platformAmount,
    femaleEarn,
    femaleEarningPercentage: safePercent,
  };
};
