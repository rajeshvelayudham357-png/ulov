export const VOICE_ROOM_STATUSES = {
  DRAFT: "draft",
  LIVE: "live",
  CLOSED: "closed",
};

export const VOICE_ROOM_SESSION_STATUSES = {
  LIVE: "live",
  CLOSED: "closed",
};

export const VOICE_ROOM_MEMBER_STATUSES = {
  JOINING: "joining",
  CONNECTED: "connected",
  BILLING: "billing",
  LEFT: "left",
  REMOVED: "removed",
  INSUFFICIENT_BALANCE: "insufficient_balance",
};

export const VOICE_ROOM_MEMBER_ROLES = {
  HOST: "host",
  PARTICIPANT: "participant",
};

export const VOICE_ROOM_EARNING_STATUSES = {
  PENDING: "pending",
  SETTLED: "settled",
};

export const VOICE_ROOM_WALLET_REFERENCE_TYPE = "voice_room";

export const DEFAULT_VOICE_ROOM_SETTINGS = {
  enabled: false,
  ratePerMinute: 5,
  hostEarningPercentage: 50,
  billingIntervalSeconds: 60,
  reconnectGraceSeconds: 30,
  maxSeats: 8,
};

export const VOICE_ROOM_MAX_SEATS_V1 = 8;

export const VOICE_ROOM_COVER_IMAGE_KEYS = {
  NEON_CIRCLE: "voiceroom1",
  PORTRAIT_GLOW: "voiceroom2",
};

export const DEFAULT_VOICE_ROOM_COVER_IMAGE_KEY =
  VOICE_ROOM_COVER_IMAGE_KEYS.NEON_CIRCLE;

export const VOICE_ROOM_COVER_IMAGE_KEY_LIST = Object.values(
  VOICE_ROOM_COVER_IMAGE_KEYS
);

export const normalizeVoiceRoomCoverImageKey = (value) => {
  const normalized = String(value ?? "").trim();

  if (VOICE_ROOM_COVER_IMAGE_KEY_LIST.includes(normalized)) {
    return normalized;
  }

  return DEFAULT_VOICE_ROOM_COVER_IMAGE_KEY;
};

export const getVoiceRoomChannelName = (sessionId) =>
  `voice_room_${Number(sessionId)}`;
