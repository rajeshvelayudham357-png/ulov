import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";
import { notifyIncomingCall } from "./notificationPush.service.js";
import { traceCallDelivery } from "../utils/callDeliveryTrace.util.js";

let tableReady = false;

const ALLOWED_EVENTS = new Set([
  "CALL_ROUTING_STARTED",
  "SOCKET_ATTEMPTED",
  "SOCKET_DELIVERED",
  "SOCKET_SKIPPED_NO_CONNECTION",
  "PUSH_ATTEMPTED",
  "PUSH_SENT",
  "PUSH_SKIPPED",
  "PUSH_FAILED",
  "NOTIFICATION_RECEIVED",
  "INCOMING_SCREEN_OPENED",
  "RINGTONE_STARTED",
  "ACCEPTED",
  "REJECTED",
  "MISSED",
  "FAILED",
]);

const sanitizeMetadata = (metadata = {}) => {
  const clean = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      clean[key] = value;
    }
  }

  return Object.keys(clean).length > 0 ? clean : null;
};

const ensureCallDeliveryTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS call_delivery_events (
id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
callId VARCHAR(64) NOT NULL,
callerId INT NULL,
creatorId INT NOT NULL,
event VARCHAR(64) NOT NULL,
metadata JSON NULL,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
INDEX idx_call_delivery_call (callId),
INDEX idx_call_delivery_creator (creatorId),
INDEX idx_call_delivery_event (event),
INDEX idx_call_delivery_created (createdAt)
)`
  );

  tableReady = true;
};

export const logCallDeliveryEvent = async ({
  callId,
  callerId,
  creatorId,
  event,
  metadata = {},
}) => {
  if (!callId || !creatorId || !event || !ALLOWED_EVENTS.has(event)) {
    return null;
  }

  await ensureCallDeliveryTable();

  const cleanMetadata = sanitizeMetadata(metadata);

  await sequelize.query(
    `INSERT INTO call_delivery_events
(callId, callerId, creatorId, event, metadata)
VALUES (:callId, :callerId, :creatorId, :event, :metadata)`,
    {
      replacements: {
        callId: String(callId),
        callerId:
          callerId === null || callerId === undefined
            ? null
            : Number(callerId),
        creatorId: Number(creatorId),
        event,
        metadata: cleanMetadata ? JSON.stringify(cleanMetadata) : null,
      },
    }
  );

  console.log("[CALL_DELIVERY]", {
    callId: String(callId),
    callerId,
    creatorId,
    event,
    ...cleanMetadata,
  });

  return true;
};

export const routeIncomingCallToCreator = async ({
  io,
  onlineUsers,
  data = {},
  creatorOnlineInDb = true,
}) => {
  const callId = data.callId ? String(data.callId) : null;
  const callerId = data.callerId;
  const creatorId = data.receiverId;

  if (!creatorId) {
    return {
      routed: false,
      reason: "missing_receiver",
    };
  }

  const payload = {
    ...data,
    callId,
    serverRouted: true,
  };

  const receiverSocket = onlineUsers?.get(String(creatorId));
  const socketFound = Boolean(receiverSocket);

  traceCallDelivery({
    stage: "RECEIVER_SOCKET_LOOKUP",
    callId,
    receiverId: String(creatorId),
    socketFound,
    socketId: socketFound ? String(receiverSocket) : null,
  });

  let socketDelivered = false;

  if (receiverSocket) {
    traceCallDelivery({
      stage: "SOCKET_EMIT_START",
      callId,
      receiverId: String(creatorId),
      socketId: String(receiverSocket),
    });

    io.to(receiverSocket).emit("incoming-call", payload);
    socketDelivered = true;

    traceCallDelivery({
      stage: "SOCKET_EMIT_COMPLETE",
      callId,
      receiverId: String(creatorId),
      socketId: String(receiverSocket),
    });
  } else {
    traceCallDelivery({
      stage: "SOCKET_SKIPPED_NO_CONNECTION",
      callId,
      receiverId: String(creatorId),
    });
  }

  const deliveryCallId =
    callId || `pending_${callerId}_${creatorId}_${Date.now()}`;

  void (async () => {
    await logCallDeliveryEvent({
      callId: deliveryCallId,
      callerId,
      creatorId,
      event: "CALL_ROUTING_STARTED",
      metadata: {
        creatorOnlineInDb: Boolean(creatorOnlineInDb),
        hasCallId: Boolean(callId),
        socketDelivered,
      },
    });

    await logCallDeliveryEvent({
      callId: callId || `pending_${callerId}_${creatorId}`,
      callerId,
      creatorId,
      event: socketDelivered ? "SOCKET_DELIVERED" : "SOCKET_SKIPPED_NO_CONNECTION",
      metadata: {
        socketConnected: Boolean(receiverSocket),
      },
    });

    await logCallDeliveryEvent({
      callId: callId || `pending_${callerId}_${creatorId}`,
      callerId,
      creatorId,
      event: "PUSH_ATTEMPTED",
      metadata: {
        socketDelivered,
      },
    });

    try {
      const pushResult = await notifyIncomingCall({
        ...payload,
        creatorOnlineInDb,
      });

      const pushSent = Boolean(pushResult?.notified);
      const pushReason = pushResult?.reason || null;

      await logCallDeliveryEvent({
        callId: callId || `pending_${callerId}_${creatorId}`,
        callerId,
        creatorId,
        event: pushSent ? "PUSH_SENT" : "PUSH_SKIPPED",
        metadata: {
          pushReason,
          expoSent: Number(pushResult?.expoSent ?? 0),
          fcmSent: Number(pushResult?.fcmSent ?? 0),
          socketDelivered,
        },
      });
    } catch (error) {
      await logCallDeliveryEvent({
        callId: callId || `pending_${callerId}_${creatorId}`,
        callerId,
        creatorId,
        event: "PUSH_FAILED",
        metadata: {
          message: String(error?.message || "push_failed"),
          socketDelivered,
        },
      });
    }
  })().catch((error) => {
    console.log("[CALL_DELIVERY_ASYNC_ERROR]", error?.message || error);
  });

  return {
    routed: true,
    socketDelivered,
    pushSent: false,
    pushReason: socketDelivered ? "socket_primary" : null,
  };
};

export const recordClientCallDeliveryEvent = async ({
  userId,
  callId,
  event,
  metadata = {},
}) => {
  const normalizedEvent = String(event || "").trim();

  if (!ALLOWED_EVENTS.has(normalizedEvent)) {
    throw new Error("Invalid call delivery event.");
  }

  if (!callId) {
    throw new Error("callId is required.");
  }

  await logCallDeliveryEvent({
    callId: String(callId),
    callerId: metadata.callerId ?? null,
    creatorId: Number(userId),
    event: normalizedEvent,
    metadata: {
      ...metadata,
      source: metadata.source || "client",
    },
  });

  return { recorded: true };
};

export const getCallDeliveryDiagnostics = async (bounds = {}) => {
  await ensureCallDeliveryTable();

  const fromUtc = bounds.fromUtc || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toUtc = bounds.toUtc || new Date();

  const [summaryRow] = await sequelize.query(
    `SELECT
       COUNT(DISTINCT callId) AS routedCalls,
       SUM(CASE WHEN event = 'SOCKET_DELIVERED' THEN 1 ELSE 0 END) AS socketDeliveredEvents,
       SUM(CASE WHEN event = 'PUSH_ATTEMPTED' THEN 1 ELSE 0 END) AS pushAttemptedEvents,
       SUM(CASE WHEN event = 'PUSH_SENT' THEN 1 ELSE 0 END) AS pushSentEvents,
       SUM(CASE WHEN event = 'NOTIFICATION_RECEIVED' THEN 1 ELSE 0 END) AS notificationReceivedEvents,
       SUM(CASE WHEN event = 'INCOMING_SCREEN_OPENED' THEN 1 ELSE 0 END) AS incomingScreenOpenedEvents,
       SUM(CASE WHEN event = 'ACCEPTED' THEN 1 ELSE 0 END) AS acceptedEvents,
       SUM(CASE WHEN event = 'MISSED' THEN 1 ELSE 0 END) AS missedEvents,
       SUM(CASE WHEN event = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedEvents
     FROM call_delivery_events
     WHERE createdAt >= :fromUtc AND createdAt <= :toUtc`,
    {
      replacements: { fromUtc, toUtc },
      type: QueryTypes.SELECT,
    }
  );

  const routedCalls = Number(summaryRow?.routedCalls) || 0;
  const pushAttempted = Number(summaryRow?.pushAttemptedEvents) || 0;
  const pushSent = Number(summaryRow?.pushSentEvents) || 0;
  const socketDelivered = Number(summaryRow?.socketDeliveredEvents) || 0;
  const notificationReceived =
    Number(summaryRow?.notificationReceivedEvents) || 0;
  const incomingScreenOpened =
    Number(summaryRow?.incomingScreenOpenedEvents) || 0;
  const accepted = Number(summaryRow?.acceptedEvents) || 0;

  const safeRate = (num, den) =>
    den > 0 ? Number(((num / den) * 100).toFixed(1)) : null;

  return {
    period: {
      fromUtc,
      toUtc,
    },
    totals: {
      routedCalls,
      pushAttemptedEvents: pushAttempted,
      pushSentEvents: pushSent,
      socketDeliveredEvents: socketDelivered,
      notificationReceivedEvents: notificationReceived,
      incomingScreenOpenedEvents: incomingScreenOpened,
      acceptedEvents: accepted,
      missedEvents: Number(summaryRow?.missedEvents) || 0,
      rejectedEvents: Number(summaryRow?.rejectedEvents) || 0,
    },
    rates: {
      socketDeliveryRatePct: safeRate(socketDelivered, routedCalls),
      pushAttemptRatePct: safeRate(pushAttempted, routedCalls),
      pushSentRatePct: safeRate(pushSent, pushAttempted),
      notificationReceivedRatePct: safeRate(notificationReceived, routedCalls),
      incomingUiOpenRatePct: safeRate(incomingScreenOpened, routedCalls),
      creatorAnswerRatePct: safeRate(accepted, routedCalls),
    },
    note:
      "Delivery diagnostics are operational signals and do not replace existing Growth BI call metric definitions.",
  };
};
