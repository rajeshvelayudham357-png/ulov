export const DEFAULT_PROFILE_ANIMATIONS = [
  {
    id: "none",
    label: "None",
    previewEmoji: "—",
    enabled: true,
    effect: "none",
  },
  {
    id: "sparkle",
    label: "Sparkle",
    previewEmoji: "✨",
    enabled: true,
    effect: "sparkle",
    accentColor: "#FFD54F",
  },
  {
    id: "hearts",
    label: "Hearts",
    previewEmoji: "💕",
    enabled: true,
    effect: "hearts",
    accentColor: "#FF2D55",
  },
  {
    id: "gold_glow",
    label: "Gold Glow",
    previewEmoji: "🌟",
    enabled: true,
    effect: "gold_video",
    accentColor: "#D4AF37",
  },
  {
    id: "diamond",
    label: "Diamond",
    previewEmoji: "💎",
    enabled: true,
    effect: "diamond",
    accentColor: "#7DD3FC",
  },
  {
    id: "confetti",
    label: "Confetti",
    previewEmoji: "🎉",
    enabled: true,
    effect: "confetti",
    accentColor: "#FF6A9E",
  },
];

export const normalizeProfileAnimationId = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!normalized || normalized === "none" || normalized === "null") {
    return null;
  }

  return normalized;
};

export const parseProfileAnimationsCatalog = (raw) => {
  if (!raw) {
    return [...DEFAULT_PROFILE_ANIMATIONS];
  }

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...DEFAULT_PROFILE_ANIMATIONS];
    }

    return parsed
      .map((item) => ({
        id: String(item?.id ?? "").trim().toLowerCase(),
        label: String(item?.label ?? "").trim(),
        previewEmoji: String(item?.previewEmoji ?? "✨").trim(),
        enabled: item?.enabled !== false && item?.enabled !== 0,
        effect: String(item?.effect ?? item?.id ?? "sparkle").trim().toLowerCase(),
        accentColor: item?.accentColor
          ? String(item.accentColor).trim()
          : null,
      }))
      .filter((item) => item.id && item.label);
  } catch {
    return [...DEFAULT_PROFILE_ANIMATIONS];
  }
};

export const getEnabledProfileAnimation = (catalog, animationId) => {
  const normalizedId = normalizeProfileAnimationId(animationId);

  if (!normalizedId) {
    return null;
  }

  const items = parseProfileAnimationsCatalog(catalog);
  const match = items.find(
    (item) => item.id === normalizedId && item.enabled
  );

  return match ?? null;
};
