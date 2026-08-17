import { GROWTH_EVENT_NAMES } from "../constants/growthEventDefinitions.js";
import { trackGrowthEvent } from "../services/growthEvents.service.js";
import { extractGrowthAttribution } from "../utils/growthAttribution.util.js";

const PUBLIC_EVENTS = new Set([
  GROWTH_EVENT_NAMES.AD_IMPRESSION,
  GROWTH_EVENT_NAMES.STORE_VISIT,
  GROWTH_EVENT_NAMES.APP_INSTALL,
  GROWTH_EVENT_NAMES.APP_OPEN,
  GROWTH_EVENT_NAMES.SESSION_STARTED,
]);

const AUTHENTICATED_EVENTS = new Set([
  GROWTH_EVENT_NAMES.CREATOR_PROFILE_VIEWED,
  GROWTH_EVENT_NAMES.REGISTRATION_STARTED,
]);

const PUBLIC_ALLOWED_EVENTS = new Set([...PUBLIC_EVENTS, ...AUTHENTICATED_EVENTS]);

const MAX_PUBLIC_BODY_BYTES = 16_384;

const resolveUserId = (req) => {
  const fromBody = req.body?.userId;
  if (fromBody) {
    return Number(fromBody);
  }
  if (req.user?.id) {
    return Number(req.user.id);
  }
  return null;
};

export const trackPublicGrowthEvent = async (req, res) => {
  try {
    const bodySize = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
    if (bodySize > MAX_PUBLIC_BODY_BYTES) {
      return res.status(413).json({ message: "Request body too large" });
    }

    const eventName = String(req.body?.eventName || "").trim().toUpperCase();
    if (!eventName) {
      return res.status(400).json({ message: "eventName is required" });
    }

    if (!PUBLIC_ALLOWED_EVENTS.has(eventName)) {
      return res.status(400).json({ message: "Invalid event name" });
    }

    const attribution = extractGrowthAttribution(req);
    const userId = resolveUserId(req);

    if (AUTHENTICATED_EVENTS.has(eventName) && !userId) {
      return res.status(400).json({
        message: "userId is required for this event",
      });
    }

    if (
      !PUBLIC_EVENTS.has(eventName) &&
      !AUTHENTICATED_EVENTS.has(eventName) &&
      !userId &&
      !attribution.anonymousId
    ) {
      return res.status(400).json({
        message: "userId or anonymousId is required for this event",
      });
    }

    const result = await trackGrowthEvent({
      eventName,
      userId,
      creatorId: req.body?.creatorId ? Number(req.body.creatorId) : null,
      anonymousId: attribution.anonymousId,
      sessionId: attribution.sessionId,
      source: attribution.source,
      medium: attribution.medium,
      campaign: attribution.campaign,
      term: attribution.term,
      content: attribution.content,
      referralCode: attribution.referralCode,
      referrerUserId: attribution.referrerUserId
        ? Number(attribution.referrerUserId)
        : null,
      platform: attribution.platform,
      appVersion: attribution.appVersion,
      deviceType: attribution.deviceType,
      os: attribution.os,
      country: attribution.country,
      language: attribution.language,
      metadata: req.body?.metadata,
      idempotencyKey: req.body?.idempotencyKey,
      createdAt: req.body?.createdAt,
    });

    if (!result.tracked && result.reason === "invalid_event_name") {
      return res.status(400).json({ message: "Invalid event name" });
    }

    return res.status(result.tracked ? 200 : 202).json({
      tracked: result.tracked,
      eventId: result.eventId ?? null,
      reason: result.reason ?? null,
    });
  } catch (error) {
    console.log("PUBLIC GROWTH EVENT ERROR", error);
    return res.status(500).json({ message: "Unable to track event" });
  }
};
