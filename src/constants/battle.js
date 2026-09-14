export const BATTLE_INVITE_STATUSES = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

export const BATTLE_ROOM_STATUSES = {
  ACCEPTED: "accepted",
  LIVE: "live",
  ENDED: "ended",
  SETTLED: "settled",
  CANCELLED: "cancelled",
};

export const BATTLE_FIGHTER_SLOTS = {
  A: "A",
  B: "B",
};

export const BATTLE_FIGHTER_STATUSES = {
  JOINING: "joining",
  CONNECTED: "connected",
  LEFT: "left",
};

export const BATTLE_AUDIENCE_STATUSES = {
  JOINING: "joining",
  CONNECTED: "connected",
  LEFT: "left",
};

export const ACTIVE_BATTLE_INVITE_STATUSES = [
  BATTLE_INVITE_STATUSES.PENDING,
];

export const ACTIVE_BATTLE_ROOM_STATUSES = [
  BATTLE_ROOM_STATUSES.ACCEPTED,
  BATTLE_ROOM_STATUSES.LIVE,
];

export const ACTIVE_BATTLE_FIGHTER_STATUSES = [
  BATTLE_FIGHTER_STATUSES.JOINING,
  BATTLE_FIGHTER_STATUSES.CONNECTED,
];

export const ACTIVE_BATTLE_AUDIENCE_STATUSES = [
  BATTLE_AUDIENCE_STATUSES.JOINING,
  BATTLE_AUDIENCE_STATUSES.CONNECTED,
];

export const DEFAULT_BATTLE_SETTINGS = {
  enabled: false,
  defaultDurationSeconds: 300,
  inviteTimeoutSeconds: 120,
};

export const getBattleChannelName = (battleId) =>
  `battle_${Number(battleId)}`;
