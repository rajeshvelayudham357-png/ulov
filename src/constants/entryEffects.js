export const MALE_ENTRY_EFFECT_IDS = ["none", "gold_dragon", "red_dragon", "lion_king"];

export const DEFAULT_MALE_ENTRY_EFFECTS = [
  {
    id: "none",
    label: "None",
    previewEmoji: "—",
    enabled: true,
  },
  {
    id: "gold_dragon",
    label: "Gold Dragon",
    previewEmoji: "🐉",
    enabled: true,
    priceCoins: 15000,
  },
  {
    id: "red_dragon",
    label: "Red Dragon",
    previewEmoji: "🔥",
    enabled: true,
    priceCoins: 5000,
  },
  {
    id: "lion_king",
    label: "Lion King",
    previewEmoji: "🦁",
    enabled: true,
    priceCoins: 2000,
  },
];

export const ENTRY_EFFECT_PRICES = {
  lion_king: 2000,
  red_dragon: 5000,
  gold_dragon: 15000,
};

export const ENTRY_EFFECT_VIDEO_IDS = ["gold_dragon", "red_dragon", "lion_king"];

export const normalizeEntryEffectId = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!normalized || normalized === "none" || normalized === "null") {
    return null;
  }

  return normalized;
};

export const getEnabledEntryEffect = (catalog, effectId) => {
  const normalizedId = normalizeEntryEffectId(effectId);

  if (!normalizedId) {
    return null;
  }

  const items =
    Array.isArray(catalog) && catalog.length > 0
      ? catalog
      : DEFAULT_MALE_ENTRY_EFFECTS;

  return (
    items.find(
      (item) =>
        String(item.id).trim().toLowerCase() === normalizedId &&
        item.enabled !== false
    ) ??
    DEFAULT_MALE_ENTRY_EFFECTS.find(
      (item) => String(item.id).trim().toLowerCase() === normalizedId
    ) ??
    null
  );
};

export const shouldShowMaleEntryEffect = (entryEffectId) => {
  const normalized = normalizeEntryEffectId(entryEffectId);

  if (!normalized) {
    return false;
  }

  return ENTRY_EFFECT_VIDEO_IDS.includes(normalized);
};
