export const PROFILE_FRAME_DURATION_DAYS = [1, 3, 7];

export const DEFAULT_PROFILE_FRAMES = [
  {
    id: "gentleman",
    label: "Gentleman",
    durationDays: 3,
    priceCoins: 250,
    enabled: true,
  },
  {
    id: "ruby_hearts",
    label: "Ruby Hearts",
    durationDays: 1,
    priceCoins: 400,
    enabled: true,
  },
  {
    id: "phoenix",
    label: "Phoenix",
    durationDays: 3,
    priceCoins: 350,
    enabled: true,
  },
  {
    id: "princess",
    label: "Princess",
    durationDays: 1,
    priceCoins: 100,
    enabled: true,
  },
  {
    id: "sakura",
    label: "Sakura Night",
    durationDays: 7,
    priceCoins: 300,
    enabled: true,
  },
  {
    id: "loveve",
    label: "Loveve",
    durationDays: 1,
    priceCoins: 150,
    enabled: true,
  },
  {
    id: "barbie",
    label: "Barbie",
    durationDays: 3,
    priceCoins: 200,
    enabled: true,
  },
  {
    id: "galaxy",
    label: "Galaxy Butterflies",
    durationDays: 1,
    priceCoins: 220,
    enabled: true,
  },
  {
    id: "royal",
    label: "Royal Crown",
    durationDays: 3,
    priceCoins: 500,
    enabled: true,
  },
];

export const normalizeProfileFrameId = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!normalized || normalized === "none" || normalized === "null") {
    return null;
  }

  return normalized;
};

export const getEnabledProfileFrame = (frameId) => {
  const normalizedId = normalizeProfileFrameId(frameId);

  if (!normalizedId) {
    return null;
  }

  return (
    DEFAULT_PROFILE_FRAMES.find(
      (item) => item.enabled !== false && item.id === normalizedId
    ) || null
  );
};
