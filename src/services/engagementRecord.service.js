import { QueryTypes } from "sequelize";

import { ENGAGEMENT_EVENT_TYPES } from "../constants/engagementEventTypes.js";
import { sequelize } from "../config/database.js";
import { ensureUserEngagementStatsSchema } from "./userEngagementSchema.service.js";

const SENTINEL_EPOCH = new Date("1970-01-01T00:00:00.000Z");

const EVENT_COLUMN_MAP = {
  [ENGAGEMENT_EVENT_TYPES.AUTH_LOGIN]: "last_auth_login_at",
  [ENGAGEMENT_EVENT_TYPES.APP_OPEN]: "last_app_open_at",
  [ENGAGEMENT_EVENT_TYPES.SESSION_STARTED]: "last_session_started_at",
  [ENGAGEMENT_EVENT_TYPES.CREATOR_PROFILE_VIEWED]:
    "last_creator_profile_viewed_at",
  [ENGAGEMENT_EVENT_TYPES.CHAT_STARTED]: "last_chat_at",
  [ENGAGEMENT_EVENT_TYPES.CALL_ATTEMPTED]: "last_call_at",
  [ENGAGEMENT_EVENT_TYPES.CALL_COMPLETED]: "last_call_at",
  [ENGAGEMENT_EVENT_TYPES.RECHARGE_COMPLETED]: "last_recharge_at",
};

export const normalizeEngagementTimestamp = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (date.getTime() > Date.now() + 60_000) {
    return null;
  }

  return date;
};

/** Pure helper for tests and monotonic merges. */
export const pickMonotonicTimestamp = (existing, incoming) => {
  const next = normalizeEngagementTimestamp(incoming);
  if (!next) {
    return normalizeEngagementTimestamp(existing);
  }

  const current = normalizeEngagementTimestamp(existing);
  if (!current) {
    return next;
  }

  return next.getTime() >= current.getTime() ? next : current;
};

const buildColumnUpdates = (eventType, occurredAt) => {
  const column = EVENT_COLUMN_MAP[eventType];
  if (!column) {
    return null;
  }

  return {
    column,
    occurredAt,
  };
};

/**
 * Records allowlisted engagement for any user (gender-agnostic table).
 * Phase 1 backfill targets males; forward events may include females on shared flows.
 */
export const recordEngagement = async ({
  userId,
  eventType,
  occurredAt = new Date(),
  transaction = null,
} = {}) => {
  try {
    const normalizedUserId = Number(userId);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
      return { ok: false, reason: "invalid_user_id" };
    }

    const columnUpdate = buildColumnUpdates(eventType, occurredAt);
    if (!columnUpdate) {
      return { ok: false, reason: "invalid_event_type" };
    }

    const eventTime = normalizeEngagementTimestamp(occurredAt);
    if (!eventTime) {
      return { ok: false, reason: "invalid_occurred_at" };
    }

    await ensureUserEngagementStatsSchema();

    const { column } = columnUpdate;
    const queryOptions = {
      replacements: {
        userId: normalizedUserId,
        eventTime,
      },
      type: QueryTypes.INSERT,
    };

    if (transaction) {
      queryOptions.transaction = transaction;
    }

    await sequelize.query(
      `INSERT INTO user_engagement_stats (
         userId,
         ${column},
         last_meaningful_activity_at,
         createdAt,
         updatedAt
       ) VALUES (
         :userId,
         :eventTime,
         :eventTime,
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP
       )
       ON DUPLICATE KEY UPDATE
         ${column} = GREATEST(
           COALESCE(${column}, :sentinel),
           :eventTime
         ),
         last_meaningful_activity_at = GREATEST(
           COALESCE(last_meaningful_activity_at, :sentinel),
           :eventTime
         ),
         updatedAt = GREATEST(
           COALESCE(updatedAt, :sentinel),
           :eventTime
         )`,
      {
        ...queryOptions,
        replacements: {
          ...queryOptions.replacements,
          sentinel: SENTINEL_EPOCH,
        },
      }
    );

    return { ok: true };
  } catch (error) {
    console.log("ENGAGEMENT RECORD ERROR", error.message);
    return { ok: false, reason: error.message };
  }
};

export const recordEngagementAsync = (payload) => {
  setImmediate(() => {
    recordEngagement(payload).catch((error) => {
      console.log("ENGAGEMENT RECORD ASYNC ERROR", error.message);
    });
  });
};

/** Record CALL_ATTEMPTED only when a new call_histories row was created (not re-upsert/update). */
export const recordCallAttemptedFromNewCallHistory = (history) => {
  if (!history?.callerId) {
    return;
  }

  recordEngagementAsync({
    userId: Number(history.callerId),
    eventType: ENGAGEMENT_EVENT_TYPES.CALL_ATTEMPTED,
    occurredAt: history.createdAt || new Date(),
  });
};

/** @deprecated Use recordCallAttemptedFromNewCallHistory after create only. */
export const recordCallAttemptedFromHistory = recordCallAttemptedFromNewCallHistory;

export const recordCallCompletedFromHistory = (history) => {
  if (!history?.callerId) {
    return;
  }

  recordEngagementAsync({
    userId: Number(history.callerId),
    eventType: ENGAGEMENT_EVENT_TYPES.CALL_COMPLETED,
    occurredAt: history.updatedAt || new Date(),
  });
};

export const mapGrowthEventToEngagement = (eventName) => {
  const normalized = String(eventName || "").trim().toUpperCase();

  if (normalized === "CREATOR_PROFILE_VIEWED") {
    return ENGAGEMENT_EVENT_TYPES.CREATOR_PROFILE_VIEWED;
  }

  if (normalized === "CHAT_STARTED") {
    return ENGAGEMENT_EVENT_TYPES.CHAT_STARTED;
  }

  if (normalized === "APP_OPEN") {
    return ENGAGEMENT_EVENT_TYPES.APP_OPEN;
  }

  if (normalized === "SESSION_STARTED") {
    return ENGAGEMENT_EVENT_TYPES.SESSION_STARTED;
  }

  return null;
};
