/** Canonical Growth BI event names — do not duplicate call_histories / payment_orders metrics. */

export const GROWTH_EVENT_NAMES = {
  // Acquisition
  AD_IMPRESSION: "AD_IMPRESSION",
  STORE_VISIT: "STORE_VISIT",
  APP_INSTALL: "APP_INSTALL",
  APP_OPEN: "APP_OPEN",

  // Registration
  REGISTRATION_STARTED: "REGISTRATION_STARTED",
  REGISTRATION_COMPLETED: "REGISTRATION_COMPLETED",
  PROFILE_COMPLETED: "PROFILE_COMPLETED",

  // Engagement
  CREATOR_PROFILE_VIEWED: "CREATOR_PROFILE_VIEWED",
  CHAT_STARTED: "CHAT_STARTED",
  MESSAGE_SENT: "MESSAGE_SENT",

  // Monetization (complement payment_orders; idempotent)
  RECHARGE_COMPLETED: "RECHARGE_COMPLETED",
  FIRST_RECHARGE: "FIRST_RECHARGE",
  REPEAT_RECHARGE: "REPEAT_RECHARGE",

  // Retention
  SESSION_STARTED: "SESSION_STARTED",
};

export const GROWTH_EVENT_SET = new Set(Object.values(GROWTH_EVENT_NAMES));

/** Events that require idempotency keys to prevent duplicates. */
export const IDEMPOTENT_GROWTH_EVENTS = new Set([
  GROWTH_EVENT_NAMES.APP_INSTALL,
  GROWTH_EVENT_NAMES.REGISTRATION_COMPLETED,
  GROWTH_EVENT_NAMES.PROFILE_COMPLETED,
  GROWTH_EVENT_NAMES.RECHARGE_COMPLETED,
  GROWTH_EVENT_NAMES.FIRST_RECHARGE,
  GROWTH_EVENT_NAMES.REPEAT_RECHARGE,
  GROWTH_EVENT_NAMES.CHAT_STARTED,
  GROWTH_EVENT_NAMES.CREATOR_PROFILE_VIEWED,
]);

/** Map growth funnel stage ids to event names (when event-backed). */
export const FUNNEL_STAGE_EVENT_MAP = {
  ad_impression: GROWTH_EVENT_NAMES.AD_IMPRESSION,
  store_visit: GROWTH_EVENT_NAMES.STORE_VISIT,
  install: GROWTH_EVENT_NAMES.APP_INSTALL,
  creator_viewed: GROWTH_EVENT_NAMES.CREATOR_PROFILE_VIEWED,
};

/** Sensitive metadata keys that must never be stored. */
export const BLOCKED_METADATA_KEYS = new Set([
  "password",
  "otp",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "pin",
  "loginPin",
  "clientSecret",
  "cardNumber",
  "cvv",
]);

export const MAX_METADATA_JSON_LENGTH = 4000;
export const MAX_UTM_LENGTH = 255;
export const MAX_EVENT_NAME_LENGTH = 64;
