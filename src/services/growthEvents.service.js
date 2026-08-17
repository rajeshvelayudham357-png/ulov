import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  BLOCKED_METADATA_KEYS,
  GROWTH_EVENT_SET,
  IDEMPOTENT_GROWTH_EVENTS,
  MAX_EVENT_NAME_LENGTH,
  MAX_METADATA_JSON_LENGTH,
  MAX_UTM_LENGTH,
} from "../constants/growthEventDefinitions.js";
import { ensureGrowthEventSchema } from "./growthEventSchema.service.js";
import {
  linkAnonymousAttributionToUser,
  upsertAttributionTouch,
} from "./userAttribution.service.js";

const sanitizeString = (value, maxLen = 255) => {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLen);
};

const sanitizeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = String(key).trim();
    if (!normalizedKey || BLOCKED_METADATA_KEYS.has(normalizedKey.toLowerCase())) {
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      clean[normalizedKey] = value;
      continue;
    }
    if (typeof value === "object") {
      try {
        clean[normalizedKey] = JSON.parse(JSON.stringify(value));
      } catch {
        // skip non-serializable values
      }
    }
  }

  const serialized = JSON.stringify(clean);
  if (serialized.length > MAX_METADATA_JSON_LENGTH) {
    return null;
  }
  return Object.keys(clean).length > 0 ? clean : null;
};

const buildIdempotencyKey = ({ eventName, userId, creatorId, anonymousId, metadata }) => {
  if (!IDEMPOTENT_GROWTH_EVENTS.has(eventName)) {
    return null;
  }

  if (eventName === "APP_INSTALL" && anonymousId) {
    return `install:${anonymousId}`;
  }
  if (eventName === "REGISTRATION_COMPLETED" && userId) {
    return `registration:${userId}`;
  }
  if (eventName === "PROFILE_COMPLETED" && userId) {
    return `profile_completed:${userId}`;
  }
  if (
    (eventName === "RECHARGE_COMPLETED" ||
      eventName === "FIRST_RECHARGE" ||
      eventName === "REPEAT_RECHARGE") &&
    metadata?.paymentOrderId
  ) {
    return `${eventName.toLowerCase()}:order:${metadata.paymentOrderId}`;
  }
  if (eventName === "CREATOR_PROFILE_VIEWED" && userId && creatorId) {
    const sessionKey = metadata?.sessionKey || metadata?.viewKey;
    if (sessionKey) {
      return `creator_view:${userId}:${creatorId}:${sessionKey}`;
    }
  }
  if (eventName === "CHAT_STARTED" && metadata?.senderId && metadata?.receiverId) {
    return `chat_started:${metadata.senderId}:${metadata.receiverId}`;
  }

  return null;
};

/**
 * Track a Growth BI event. Non-throwing — analytics must not break user flows.
 * @returns {Promise<{ tracked: boolean, eventId?: number, reason?: string }>}
 */
export const trackGrowthEvent = async (payload = {}) => {
  try {
    await ensureGrowthEventSchema();

    const eventName = sanitizeString(payload.eventName, MAX_EVENT_NAME_LENGTH)?.toUpperCase();
    if (!eventName || !GROWTH_EVENT_SET.has(eventName)) {
      return { tracked: false, reason: "invalid_event_name" };
    }

    const userId = payload.userId ? Number(payload.userId) : null;
    const creatorId = payload.creatorId ? Number(payload.creatorId) : null;
    const referrerUserId = payload.referrerUserId
      ? Number(payload.referrerUserId)
      : null;

    if (payload.createdAt) {
      const ts = new Date(payload.createdAt);
      if (Number.isNaN(ts.getTime()) || ts.getTime() > Date.now() + 60_000) {
        return { tracked: false, reason: "invalid_timestamp" };
      }
    }

    const metadata = sanitizeMetadata(payload.metadata);
    const idempotencyKey =
      sanitizeString(payload.idempotencyKey, 128) ||
      buildIdempotencyKey({
        eventName,
        userId,
        creatorId,
        anonymousId: payload.anonymousId,
        metadata,
      });

    const attributionFields = {
      source: sanitizeString(payload.source, MAX_UTM_LENGTH),
      medium: sanitizeString(payload.medium, MAX_UTM_LENGTH),
      campaign: sanitizeString(payload.campaign, MAX_UTM_LENGTH),
      term: sanitizeString(payload.term, MAX_UTM_LENGTH),
      content: sanitizeString(payload.content, MAX_UTM_LENGTH),
      referralCode: sanitizeString(payload.referralCode, 64),
      referrerUserId,
      platform: sanitizeString(payload.platform, 32),
      appVersion: sanitizeString(payload.appVersion, 32),
      anonymousId: sanitizeString(payload.anonymousId, 64),
      userId,
    };

    if (
      attributionFields.source ||
      attributionFields.medium ||
      attributionFields.campaign ||
      attributionFields.referralCode ||
      attributionFields.referrerUserId
    ) {
      await upsertAttributionTouch(attributionFields).catch((err) => {
        console.log("ATTRIBUTION TOUCH ERROR", err.message);
      });
    }

    if (userId && attributionFields.anonymousId) {
      await linkAnonymousAttributionToUser({
        userId,
        anonymousId: attributionFields.anonymousId,
      }).catch((err) => {
        console.log("ATTRIBUTION LINK ERROR", err.message);
      });
    }

    const replacements = {
      eventName,
      userId,
      creatorId,
      anonymousId: sanitizeString(payload.anonymousId, 64),
      sessionId: sanitizeString(payload.sessionId, 64),
      idempotencyKey,
      source: attributionFields.source,
      medium: attributionFields.medium,
      campaign: attributionFields.campaign,
      term: sanitizeString(payload.term, MAX_UTM_LENGTH),
      content: sanitizeString(payload.content, MAX_UTM_LENGTH),
      referralCode: attributionFields.referralCode,
      referrerUserId,
      platform: attributionFields.platform,
      appVersion: attributionFields.appVersion,
      deviceType: sanitizeString(payload.deviceType, 32),
      os: sanitizeString(payload.os, 64),
      country: sanitizeString(payload.country, 64),
      language: sanitizeString(payload.language, 16),
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
    };

    if (idempotencyKey) {
      const [existing] = await sequelize.query(
        `SELECT id FROM growth_events WHERE idempotencyKey = :idempotencyKey LIMIT 1`,
        { replacements: { idempotencyKey }, type: QueryTypes.SELECT }
      );
      if (existing?.id) {
        return { tracked: true, eventId: existing.id, reason: "duplicate" };
      }
    }

    const [result] = await sequelize.query(
      `INSERT INTO growth_events (
         eventName, userId, creatorId, anonymousId, sessionId, idempotencyKey,
         source, medium, campaign, term, content,
         referralCode, referrerUserId,
         platform, appVersion, deviceType, os, country, language,
         metadata, createdAt
       ) VALUES (
         :eventName, :userId, :creatorId, :anonymousId, :sessionId, :idempotencyKey,
         :source, :medium, :campaign, :term, :content,
         :referralCode, :referrerUserId,
         :platform, :appVersion, :deviceType, :os, :country, :language,
         :metadata, :createdAt
       )`,
      { replacements, type: QueryTypes.INSERT }
    );

    return { tracked: true, eventId: result };
  } catch (error) {
    if (String(error.message).includes("Duplicate entry") && payload.idempotencyKey) {
      return { tracked: true, reason: "duplicate" };
    }
    console.log("GROWTH EVENT TRACK ERROR", error.message);
    return { tracked: false, reason: error.message };
  }
};

/** Fire-and-forget wrapper for request handlers. */
export const trackGrowthEventAsync = (payload) => {
  setImmediate(() => {
    trackGrowthEvent(payload).catch((err) => {
      console.log("GROWTH EVENT ASYNC ERROR", err.message);
    });
  });
};

export const hasGrowthEventsEver = async (eventName) => {
  await ensureGrowthEventSchema();

  const [row] = await sequelize.query(
    `SELECT id FROM growth_events WHERE eventName = :eventName LIMIT 1`,
    {
      replacements: { eventName },
      type: QueryTypes.SELECT,
    }
  );

  return Boolean(row?.id);
};

export const countGrowthEvents = async (bounds, { eventName, distinctUser = false, distinctAnonymous = false }) => {
  await ensureGrowthEventSchema();

  const distinctExpr = distinctUser
    ? "COUNT(DISTINCT userId)"
    : distinctAnonymous
      ? "COUNT(DISTINCT anonymousId)"
      : "COUNT(*)";

  const userFilter = distinctUser ? "AND userId IS NOT NULL" : "";
  const anonFilter = distinctAnonymous ? "AND anonymousId IS NOT NULL" : "";

  const [row] = await sequelize.query(
    `SELECT ${distinctExpr} AS count
     FROM growth_events
     WHERE eventName = :eventName
       AND createdAt >= :fromUtc AND createdAt <= :toUtc
       ${userFilter}
       ${anonFilter}`,
    {
      replacements: {
        eventName,
        fromUtc: bounds.fromUtc,
        toUtc: bounds.toUtc,
      },
      type: QueryTypes.SELECT,
    }
  );

  return Number(row?.count) || 0;
};

export { sanitizeMetadata, sanitizeString };
