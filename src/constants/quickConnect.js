export const CALL_MODES = {
  DIRECT: "direct",
  QUICK_CONNECT: "quick_connect",
};

export const SESSION_STATUS = {
  ROUTING: "routing",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ENDED: "ended",
  CANCELLED: "cancelled",
  FAILED: "failed",
};

export const ATTEMPT_STATUS = {
  CREATED: "created",
  RINGING: "ringing",
  ACCEPTED: "accepted",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  REJECTED: "rejected",
  MISSED: "missed",
  BUSY: "busy",
  OFFLINE: "offline",
  CANCELLED: "cancelled",
  FAILED: "failed",
  ENDED: "ended",
};

export const TERMINAL_ATTEMPT_STATUSES = new Set([
  ATTEMPT_STATUS.REJECTED,
  ATTEMPT_STATUS.MISSED,
  ATTEMPT_STATUS.BUSY,
  ATTEMPT_STATUS.OFFLINE,
  ATTEMPT_STATUS.CANCELLED,
  ATTEMPT_STATUS.FAILED,
  ATTEMPT_STATUS.ENDED,
  ATTEMPT_STATUS.CONNECTED,
]);

export const DEFAULT_QUICK_CONNECT = {
  maxAttempts: 3,
  ringTimeoutSeconds: 10,
  maxRoutingSeconds: 30,
  maxSelectionRetries: 20,
  minOnlineMinutes: 15,
};

export const MAX_SELECTION_RETRIES =
  DEFAULT_QUICK_CONNECT.maxSelectionRetries;

export const NO_CREATORS_MESSAGE = "No creator available now";

export const QC_TABLES = {
  SESSIONS: "quick_connect_sessions",
  ATTEMPTS: "call_attempts",
  RESERVATIONS: "creator_call_reservations",
};

export const normalizeCallMode = (mode) => {
  const value = String(mode ?? CALL_MODES.DIRECT).trim().toLowerCase();

  if (value === CALL_MODES.QUICK_CONNECT) {
    return CALL_MODES.QUICK_CONNECT;
  }

  return CALL_MODES.DIRECT;
};
