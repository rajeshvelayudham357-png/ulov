import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  ATTEMPT_STATUS,
  CALL_MODES,
  DEFAULT_QUICK_CONNECT,
  MAX_SELECTION_RETRIES,
  NO_CREATORS_MESSAGE,
  QC_TABLES,
  SESSION_STATUS,
} from "../constants/quickConnect.js";
import { normalizeCallTypeForDb } from "../constants/callTypes.js";
import { CallHistory, User } from "../models/index.js";
import { generateAgoraToken, getAgoraAppId } from "./agora.service.js";
import { areUsersBlocked } from "./block.service.js";
import {
  findActiveCallForReceiver,
  getChannelNameForCall,
  isReceiverBusyWithOther,
} from "./callState.service.js";
import {
  logCallDeliveryEvent,
  routeIncomingCallToCreator,
} from "./callDelivery.service.js";
import {
  isCreatorReserved,
  releaseCreatorReservation,
  releaseExpiredReservations,
  reserveCreatorAtomically,
} from "./creatorReservation.service.js";
import { getAppSettings } from "./appSettings.service.js";
import { ensureQuickConnectSchema } from "./quickConnectSchema.service.js";

let ioInstance = null;
let onlineUsersRef = null;

export const setQuickConnectRuntime = ({ io, onlineUsers }) => {
  ioInstance = io;
  onlineUsersRef = onlineUsers;
};

const getRuntime = () => ({
  io: ioInstance,
  onlineUsers: onlineUsersRef,
});

const getInsertId = (queryResult) => {
  const [first, second] = queryResult;

  if (second && typeof second === "object" && second.insertId != null) {
    return Number(second.insertId);
  }

  return Number(first);
};

const mapAcceptFailureReason = (reason) => {
  const value = String(reason || "").trim().toLowerCase();

  if (value === "timeout_or_not_ringing") {
    return "expired";
  }

  if (value === "session_not_routing") {
    return "session_ended";
  }

  if (value === "forbidden") {
    return "unavailable";
  }

  return value || "unavailable";
};

const fetchRungCreatorIdsForSession = async (sessionId) => {
  const rows = await sequelize.query(
    `SELECT DISTINCT receiverId
     FROM ${QC_TABLES.ATTEMPTS}
     WHERE sessionId = :sessionId
       AND status NOT IN ('created')`,
    {
      replacements: { sessionId: Number(sessionId) },
      type: QueryTypes.SELECT,
    }
  );

  return rows
    .map((row) => Number(row.receiverId))
    .filter((id) => Number.isFinite(id));
};

const cleanupRingAttemptOnError = async ({
  attemptId,
  callHistoryId,
  creatorId,
  sessionId,
  failureReason = "routing_error",
}) => {
  if (attemptId) {
    await transitionAttemptStatus({
      attemptId,
      fromStatus: ATTEMPT_STATUS.CREATED,
      toStatus: ATTEMPT_STATUS.FAILED,
      failureReason,
    }).catch(() => {});

    await transitionAttemptStatus({
      attemptId,
      fromStatus: ATTEMPT_STATUS.RINGING,
      toStatus: ATTEMPT_STATUS.FAILED,
      failureReason,
    }).catch(() => {});

    await sequelize.query(
      `UPDATE ${QC_TABLES.ATTEMPTS}
       SET status = :failedStatus,
           failureReason = :failureReason,
           endedAt = NOW(),
           updatedAt = NOW()
       WHERE id = :attemptId
         AND status IN ('created', 'ringing')`,
      {
        replacements: {
          attemptId: Number(attemptId),
          failedStatus: ATTEMPT_STATUS.FAILED,
          failureReason,
        },
      }
    );
  }

  if (callHistoryId) {
    await CallHistory.update(
      {
        status: "cancelled",
        duration: 0,
        coinsSpent: 0,
      },
      {
        where: {
          id: callHistoryId,
          coinsSpent: 0,
        },
      }
    ).catch(() => {});
  }

  if (creatorId) {
    await releaseCreatorReservation({
      creatorId,
      sessionId,
      attemptId,
    });
  }
};

const validateCreatorBeforeRing = async ({
  creatorId,
  callerId,
}) => {
  const creator = await User.findByPk(creatorId, {
    attributes: ["id", "online"],
  });

  if (!creator || !Boolean(creator.online)) {
    return { ok: false, reason: "offline" };
  }

  const busy = await isReceiverBusyWithOther(creatorId, callerId);

  if (busy) {
    return { ok: false, reason: "busy" };
  }

  const reserved = await isCreatorReserved(creatorId);

  if (reserved) {
    return { ok: false, reason: "already_reserved" };
  }

  return { ok: true };
};

const fetchSessionById = async (sessionId, transaction = null) => {
  const rows = await sequelize.query(
    `SELECT *
     FROM ${QC_TABLES.SESSIONS}
     WHERE id = :sessionId
     LIMIT 1`,
    {
      replacements: { sessionId: Number(sessionId) },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  return rows[0] || null;
};

const fetchAttemptById = async (attemptId, transaction = null) => {
  const rows = await sequelize.query(
    `SELECT *
     FROM ${QC_TABLES.ATTEMPTS}
     WHERE id = :attemptId
     LIMIT 1`,
    {
      replacements: { attemptId: Number(attemptId) },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  return rows[0] || null;
};

const fetchAttemptByCallHistoryId = async (callHistoryId) => {
  const rows = await sequelize.query(
    `SELECT *
     FROM ${QC_TABLES.ATTEMPTS}
     WHERE callHistoryId = :callHistoryId
     LIMIT 1`,
    {
      replacements: { callHistoryId: Number(callHistoryId) },
      type: QueryTypes.SELECT,
    }
  );

  return rows[0] || null;
};

const getQuickConnectSettings = async () => {
  const settings = await getAppSettings();

  const maxAttempts = Math.min(
    5,
    Math.max(1, Number(settings.quickConnectMaxAttempts ?? DEFAULT_QUICK_CONNECT.maxAttempts))
  );

  const ringTimeoutSeconds = Math.min(
    30,
    Math.max(
      5,
      Number(settings.quickConnectRingTimeoutSeconds ?? DEFAULT_QUICK_CONNECT.ringTimeoutSeconds)
    )
  );

  return {
    enabled: Boolean(settings.quickConnectEnabled),
    maxAttempts,
    ringTimeoutSeconds,
    maxRoutingSeconds: Number(
      settings.quickConnectMaxRoutingSeconds ?? DEFAULT_QUICK_CONNECT.maxRoutingSeconds
    ),
  };
};

export const isQuickConnectEnabled = async () => {
  const settings = await getQuickConnectSettings();
  return settings.enabled;
};

const logQuickConnectEvent = async (event, metadata = {}) => {
  try {
    await logCallDeliveryEvent({
      callId: metadata.callId ? String(metadata.callId) : `qc_${metadata.sessionId || "unknown"}`,
      callerId: metadata.callerId ?? null,
      creatorId: metadata.creatorId ?? metadata.receiverId ?? 0,
      event: metadata.deliveryEvent || "CALL_ROUTING_STARTED",
      metadata: {
        quickConnectEvent: event,
        ...metadata,
      },
    });
  } catch (error) {
    console.log("[QUICK_CONNECT_EVENT_ERROR]", event, error.message);
  }
};

const emitToCaller = (callerId, event, payload) => {
  const { io, onlineUsers } = getRuntime();

  if (!io || !onlineUsers) {
    return false;
  }

  const callerSocket = onlineUsers.get(String(callerId));

  if (!callerSocket) {
    return false;
  }

  io.to(callerSocket).emit(event, payload);
  return true;
};

const emitToCreator = (creatorId, event, payload) => {
  const { io, onlineUsers } = getRuntime();

  if (!io || !onlineUsers) {
    return false;
  }

  const creatorSocket = onlineUsers.get(String(creatorId));

  if (!creatorSocket) {
    return false;
  }

  io.to(creatorSocket).emit(event, payload);
  return true;
};

const markSessionEnded = async ({
  sessionId,
  status = SESSION_STATUS.ENDED,
  connectedCallHistoryId = null,
}) => {
  await sequelize.query(
    `UPDATE ${QC_TABLES.SESSIONS}
     SET status = :status,
         endedAt = NOW(),
         connectedCallHistoryId = COALESCE(:connectedCallHistoryId, connectedCallHistoryId),
         updatedAt = NOW()
     WHERE id = :sessionId
       AND status IN ('routing', 'connecting')`,
    {
      replacements: {
        sessionId: Number(sessionId),
        status,
        connectedCallHistoryId,
      },
    }
  );
};

const selectEligibleCreator = async ({
  callerId,
  callType,
  excludedReceiverIds = [],
}) => {
  const normalizedType = normalizeCallTypeForDb(callType);
  const excluded = excludedReceiverIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  const blockedRows = await sequelize.query(
    `SELECT blockedUserId AS userId
     FROM blocks
     WHERE blockerId = :callerId
     UNION
     SELECT blockerId AS userId
     FROM blocks
     WHERE blockedUserId = :callerId`,
    {
      replacements: { callerId: Number(callerId) },
      type: QueryTypes.SELECT,
    }
  ).catch(() => []);

  const blockedIds = new Set(
    blockedRows.map((row) => Number(row.userId)).filter((id) => Number.isFinite(id))
  );

  for (const blockedId of blockedIds) {
    excluded.push(blockedId);
  }

  const excludedClause =
    excluded.length > 0
      ? `AND u.id NOT IN (${excluded.map((_, index) => `:excluded${index}`).join(", ")})`
      : "";

  const replacements = {
    callerId: Number(callerId),
  };

  excluded.forEach((id, index) => {
    replacements[`excluded${index}`] = id;
  });

  const voiceClause =
    normalizedType === "voice"
      ? "AND COALESCE(u.acceptVoiceCalls, 1) = 1"
      : "AND COALESCE(u.acceptVideoCalls, 1) = 1";

  const rows = await sequelize.query(
    `SELECT u.id, u.nickname, u.avatar, u.online
     FROM users u
     WHERE LOWER(COALESCE(u.gender, '')) = 'female'
       AND COALESCE(u.accountStatus, 'pending') = 'approved'
       AND COALESCE(u.blocked, 0) = 0
       AND COALESCE(u.online, 0) = 1
       ${voiceClause}
       ${excludedClause}
       AND NOT EXISTS (
         SELECT 1
         FROM creator_call_reservations r
         WHERE r.creatorId = u.id
           AND r.expiresAt > NOW()
       )
       AND NOT EXISTS (
         SELECT 1
         FROM call_histories ch
         WHERE ch.receiverId = u.id
           AND ch.status IN ('live', 'ringing', 'accepted', 'ongoing', 'in_progress')
       )
     ORDER BY u.lastLoginAt DESC, u.id DESC
     LIMIT 20`,
    {
      replacements,
      type: QueryTypes.SELECT,
    }
  );

  for (const row of rows) {
    const receiverId = Number(row.id);

    const blocked = await areUsersBlocked(callerId, receiverId);

    if (blocked) {
      continue;
    }

    const busy = await isReceiverBusyWithOther(receiverId, callerId);

    if (busy) {
      continue;
    }

    const reserved = await isCreatorReserved(receiverId);

    if (reserved) {
      continue;
    }

    return row;
  }

  return null;
};

const getQuickConnectEligibilitySnapshot = async (callType = "voice") => {
  const normalizedType = normalizeCallTypeForDb(callType);
  const voiceClause =
    normalizedType === "voice"
      ? "AND COALESCE(u.acceptVoiceCalls, 1) = 1"
      : "AND COALESCE(u.acceptVideoCalls, 1) = 1";

  const [rows] = await sequelize.query(
    `SELECT
       SUM(
         CASE
           WHEN LOWER(COALESCE(u.gender, '')) = 'female'
             AND COALESCE(u.accountStatus, 'pending') = 'approved'
             AND COALESCE(u.blocked, 0) = 0
           THEN 1 ELSE 0
         END
       ) AS approvedFemales,
       SUM(
         CASE
           WHEN LOWER(COALESCE(u.gender, '')) = 'female'
             AND COALESCE(u.accountStatus, 'pending') = 'approved'
             AND COALESCE(u.blocked, 0) = 0
             AND COALESCE(u.online, 0) = 1
           THEN 1 ELSE 0
         END
       ) AS onlineApprovedFemales,
       SUM(
         CASE
           WHEN LOWER(COALESCE(u.gender, '')) = 'female'
             AND COALESCE(u.accountStatus, 'pending') = 'approved'
             AND COALESCE(u.blocked, 0) = 0
             AND COALESCE(u.online, 0) = 1
             ${voiceClause}
           THEN 1 ELSE 0
         END
       ) AS onlineOptInFemales
     FROM users u`
  );

  return {
    approvedFemales: Number(rows[0]?.approvedFemales ?? 0),
    onlineApprovedFemales: Number(rows[0]?.onlineApprovedFemales ?? 0),
    onlineOptInFemales: Number(rows[0]?.onlineOptInFemales ?? 0),
  };
};

const buildNoCreatorsMessage = async () => NO_CREATORS_MESSAGE;

const buildAttemptResponse = async ({
  session,
  attempt,
  callHistory,
  callerId,
  receiver,
}) => {
  const channelName = getChannelNameForCall(callHistory.id);
  const callerUid = Number(callerId);
  const receiverUid = Number(receiver.id);

  const callerToken = await generateAgoraToken(channelName, callerUid);
  const receiverToken = await generateAgoraToken(channelName, receiverUid);
  const appId = await getAgoraAppId();

  return {
    success: true,
    mode: CALL_MODES.QUICK_CONNECT,
    sessionId: Number(session.id),
    attemptId: Number(attempt.id),
    attemptNumber: Number(attempt.attemptNumber),
    appId,
    channelName,
    callId: callHistory.id,
    caller: {
      uid: callerUid,
      token: callerToken,
    },
    receiver: {
      uid: receiverUid,
      token: receiverToken,
      id: receiverUid,
      name: receiver.nickname || "Creator",
      avatar: receiver.avatar || null,
    },
  };
};

const resolveCallerPresentation = async (
  callerId,
  callerName = null,
  callerAvatar = null
) => {
  const caller = await User.findByPk(Number(callerId), {
    attributes: ["nickname", "name", "avatar"],
  });

  return {
    callerName:
      callerName ||
      caller?.nickname ||
      caller?.name ||
      "Caller",
    callerAvatar: callerAvatar || caller?.avatar || null,
  };
};

const ringCreatorForAttempt = async ({
  session,
  attempt,
  callHistory,
  callerId,
  receiver,
  callerName = null,
  callerAvatar = null,
  callType,
}) => {
  const { io, onlineUsers } = getRuntime();
  const channelName = getChannelNameForCall(callHistory.id);
  const receiverUid = Number(receiver.id);
  const receiverToken = await generateAgoraToken(channelName, receiverUid);
  const presentation = await resolveCallerPresentation(
    callerId,
    callerName,
    callerAvatar
  );

  const payload = {
    callerId: String(callerId),
    receiverId: String(receiver.id),
    callerName: presentation.callerName,
    avatar: presentation.callerAvatar || undefined,
    channelName,
    type: callType === "voice" ? "audio" : "video",
    callId: String(callHistory.id),
    sessionId: String(session.id),
    attemptId: String(attempt.id),
    attemptNumber: Number(attempt.attemptNumber),
    mode: CALL_MODES.QUICK_CONNECT,
    serverRouted: true,
    token: receiverToken,
    uid: String(receiverUid),
  };

  await routeIncomingCallToCreator({
    io,
    onlineUsers,
    data: payload,
    creatorOnlineInDb: Boolean(receiver.online),
  });

  await logQuickConnectEvent("call_ring_started", {
    sessionId: session.id,
    attemptId: attempt.id,
    callId: callHistory.id,
    callerId,
    receiverId: receiver.id,
    attemptNumber: attempt.attemptNumber,
    deliveryEvent: "CALL_ROUTING_STARTED",
  });
};

export const createQuickConnectSession = async ({
  callerId,
  type,
  callerName = null,
  callerAvatar = null,
}) => {
  await ensureQuickConnectSchema();

  const settings = await getQuickConnectSettings();

  if (!settings.enabled) {
    const error = new Error("Quick Connect is not available right now");
    error.statusCode = 403;
    throw error;
  }

  const normalizedType = normalizeCallTypeForDb(type);
  const callerIdNum = Number(callerId);

  if (!Number.isFinite(callerIdNum)) {
    const error = new Error("callerId required");
    error.statusCode = 400;
    throw error;
  }

  const deadlineAt = new Date(
    Date.now() + settings.maxRoutingSeconds * 1000
  );

  const sessionResult = await sequelize.query(
    `INSERT INTO ${QC_TABLES.SESSIONS}
     (callerId, callType, mode, status, maxAttempts, attemptCount, startedAt, deadlineAt)
     VALUES (:callerId, :callType, :mode, :status, :maxAttempts, 0, NOW(), :deadlineAt)`,
    {
      replacements: {
        callerId: callerIdNum,
        callType: normalizedType,
        mode: CALL_MODES.QUICK_CONNECT,
        status: SESSION_STATUS.ROUTING,
        maxAttempts: settings.maxAttempts,
        deadlineAt,
      },
    }
  );

  const sessionId = getInsertId(sessionResult);

  await logQuickConnectEvent("call_session_created", {
    sessionId,
    callerId: callerIdNum,
    callType: normalizedType,
    deliveryEvent: "CALL_ROUTING_STARTED",
  });

  const session = await fetchSessionById(sessionId);

  const attemptResult = await startNextQuickConnectAttempt({
    sessionId,
    callerName,
    callerAvatar,
  });

  if (!attemptResult?.success) {
    await markSessionEnded({
      sessionId,
      status: SESSION_STATUS.FAILED,
    });

    const noCreatorsMessage = await buildNoCreatorsMessage(session?.callType || normalizedType);

    emitToCaller(callerIdNum, "call-session-ended", {
      sessionId: String(sessionId),
      reason: attemptResult?.reason || "no_creators",
      status: SESSION_STATUS.FAILED,
    });

    const error = new Error(
      attemptResult?.message || noCreatorsMessage
    );
    error.statusCode = 409;
    throw error;
  }

  return attemptResult;
};

export const startNextQuickConnectAttempt = async ({
  sessionId,
  callerName = null,
  callerAvatar = null,
  previousAttemptId = null,
  failureReason = null,
}) => {
  await ensureQuickConnectSchema();

  const settings = await getQuickConnectSettings();
  let session = await fetchSessionById(sessionId);

  if (!session) {
    return { success: false, reason: "session_not_found" };
  }

  if (
    session.status !== SESSION_STATUS.ROUTING ||
    new Date(session.deadlineAt).getTime() <= Date.now()
  ) {
    return { success: false, reason: "session_not_routing" };
  }

  if (Number(session.attemptCount) >= Number(session.maxAttempts)) {
    return { success: false, reason: "max_attempts_reached" };
  }

  const excludedReceiverIds = await fetchRungCreatorIdsForSession(sessionId);
  const selectionExcluded = new Set(excludedReceiverIds);
  let selectionRetries = 0;

  while (selectionRetries < MAX_SELECTION_RETRIES) {
    selectionRetries += 1;

    session = await fetchSessionById(sessionId);

    if (
      !session ||
      session.status !== SESSION_STATUS.ROUTING ||
      new Date(session.deadlineAt).getTime() <= Date.now()
    ) {
      return { success: false, reason: "session_not_routing" };
    }

    if (Number(session.attemptCount) >= Number(session.maxAttempts)) {
      return { success: false, reason: "max_attempts_reached" };
    }

    const creator = await selectEligibleCreator({
      callerId: session.callerId,
      callType: session.callType,
      excludedReceiverIds: [...selectionExcluded],
    });

    if (!creator) {
      break;
    }

    const creatorId = Number(creator.id);
    const preRingValidation = await validateCreatorBeforeRing({
      creatorId,
      callerId: session.callerId,
    });

    if (!preRingValidation.ok) {
      selectionExcluded.add(creatorId);
      continue;
    }

    const attemptNumber = Number(session.attemptCount) + 1;
    const ringStartedAt = new Date();
    const ringExpiresAt = new Date(
      ringStartedAt.getTime() + settings.ringTimeoutSeconds * 1000
    );

    const attemptResult = await sequelize.query(
      `INSERT INTO ${QC_TABLES.ATTEMPTS}
       (sessionId, receiverId, attemptNumber, status, ringStartedAt, ringExpiresAt, failureReason)
       VALUES (:sessionId, :receiverId, :attemptNumber, :status, :ringStartedAt, :ringExpiresAt, :failureReason)`,
      {
        replacements: {
          sessionId: Number(sessionId),
          receiverId: creatorId,
          attemptNumber,
          status: ATTEMPT_STATUS.CREATED,
          ringStartedAt,
          ringExpiresAt,
          failureReason,
        },
      }
    );

    const attemptId = getInsertId(attemptResult);
    let callHistoryId = null;

    const reservation = await reserveCreatorAtomically({
      creatorId,
      sessionId,
      attemptId,
      expiresAt: ringExpiresAt,
    });

    if (!reservation.reserved) {
      await sequelize.query(`DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE id = :attemptId`, {
        replacements: { attemptId },
      });
      selectionExcluded.add(creatorId);
      continue;
    }

    try {
      const callHistory = await CallHistory.create({
        callerId: session.callerId,
        receiverId: creatorId,
        type: session.callType,
        duration: 0,
        coinsSpent: 0,
        status: "ringing",
      });

      callHistoryId = callHistory.id;

      await sequelize.query(
        `UPDATE ${QC_TABLES.ATTEMPTS}
         SET callHistoryId = :callHistoryId,
             status = :status,
             updatedAt = NOW()
         WHERE id = :attemptId
           AND status = :createdStatus`,
        {
          replacements: {
            attemptId,
            callHistoryId: callHistory.id,
            status: ATTEMPT_STATUS.RINGING,
            createdStatus: ATTEMPT_STATUS.CREATED,
          },
        }
      );

      const [, sessionUpdateMeta] = await sequelize.query(
        `UPDATE ${QC_TABLES.SESSIONS}
         SET attemptCount = attemptCount + 1,
             updatedAt = NOW()
         WHERE id = :sessionId
           AND status = :routingStatus
           AND attemptCount = :expectedAttemptCount`,
        {
          replacements: {
            sessionId: Number(sessionId),
            routingStatus: SESSION_STATUS.ROUTING,
            expectedAttemptCount: Number(session.attemptCount),
          },
        }
      );

      if (Number(sessionUpdateMeta?.affectedRows ?? 0) <= 0) {
        throw new Error("session_attempt_count_conflict");
      }

      const attempt = await fetchAttemptById(attemptId);
      const refreshedSession = await fetchSessionById(sessionId);

      await ringCreatorForAttempt({
        session: refreshedSession,
        attempt,
        callHistory,
        callerId: session.callerId,
        receiver: creator,
        callerName,
        callerAvatar,
        callType: session.callType,
      });

      await logQuickConnectEvent("call_attempt_created", {
        sessionId,
        attemptId,
        callId: callHistory.id,
        callerId: session.callerId,
        receiverId: creatorId,
        attemptNumber,
        deliveryEvent: "CALL_ROUTING_STARTED",
      });

      const attemptResponse = await buildAttemptResponse({
        session: refreshedSession,
        attempt,
        callHistory,
        callerId: session.callerId,
        receiver: creator,
      });

      if (previousAttemptId) {
        emitToCaller(session.callerId, "call-rerouted", {
          ...attemptResponse,
          previousAttemptId: String(previousAttemptId),
          nextAttemptId: String(attemptId),
          reason: failureReason || "rerouted",
          status: ATTEMPT_STATUS.RINGING,
        });

        await logQuickConnectEvent("call_rerouted", {
          sessionId,
          previousAttemptId,
          attemptId,
          callerId: session.callerId,
          receiverId: creatorId,
          attemptNumber,
          reason: failureReason,
        });
      }

      return attemptResponse;
    } catch (error) {
      console.log("[QUICK_CONNECT_RING_ERROR]", sessionId, attemptId, error.message);

      await cleanupRingAttemptOnError({
        attemptId,
        callHistoryId,
        creatorId,
        sessionId,
        failureReason: "routing_error",
      });

      selectionExcluded.add(creatorId);
    }
  }

  await markSessionEnded({
    sessionId,
    status: SESSION_STATUS.FAILED,
  });

  emitToCaller(session?.callerId, "call-session-ended", {
    sessionId: String(sessionId),
    reason: "no_available_creator",
    status: SESSION_STATUS.FAILED,
  });

  return {
    success: false,
    reason: "no_available_creator",
    message: NO_CREATORS_MESSAGE,
  };
};

const finalizeFailedAttempt = async ({
  attempt,
  session,
  terminalStatus,
  failureReason,
}) => {
  if (!attempt || !session) {
    return { handled: false };
  }

  await releaseCreatorReservation({
    creatorId: attempt.receiverId,
    sessionId: session.id,
    attemptId: attempt.id,
  });

  if (attempt.callHistoryId) {
    await CallHistory.update(
      {
        status:
          terminalStatus === ATTEMPT_STATUS.MISSED
            ? "missed"
            : terminalStatus === ATTEMPT_STATUS.REJECTED
              ? "rejected"
              : terminalStatus === ATTEMPT_STATUS.BUSY
                ? "missed"
                : terminalStatus === ATTEMPT_STATUS.OFFLINE
                  ? "missed"
                  : terminalStatus === ATTEMPT_STATUS.CANCELLED
                    ? "cancelled"
                    : "missed",
        duration: 0,
        coinsSpent: 0,
      },
      {
        where: {
          id: attempt.callHistoryId,
          coinsSpent: 0,
        },
      }
    );
  }

  emitToCreator(attempt.receiverId, "call-cancelled", {
    callerId: String(session.callerId),
    receiverId: String(attempt.receiverId),
    callId: attempt.callHistoryId ? String(attempt.callHistoryId) : undefined,
    sessionId: String(session.id),
    attemptId: String(attempt.id),
    reason: failureReason,
  });

  const refreshedSession = await fetchSessionById(session.id);

  if (
    refreshedSession?.status !== SESSION_STATUS.ROUTING ||
    Number(refreshedSession.attemptCount) >= Number(refreshedSession.maxAttempts) ||
    new Date(refreshedSession.deadlineAt).getTime() <= Date.now()
  ) {
    await markSessionEnded({
      sessionId: session.id,
      status: SESSION_STATUS.ENDED,
    });

    emitToCaller(session.callerId, "call-session-ended", {
      sessionId: String(session.id),
      reason: failureReason || terminalStatus,
      status: SESSION_STATUS.ENDED,
    });

    return { handled: true, sessionEnded: true };
  }

  await startNextQuickConnectAttempt({
    sessionId: session.id,
    previousAttemptId: attempt.id,
    failureReason: failureReason || terminalStatus,
  });

  return { handled: true, sessionEnded: false };
};

export const transitionAttemptStatus = async ({
  attemptId,
  fromStatus,
  toStatus,
  failureReason = null,
  extraSetSql = "",
}) => {
  const [, metadata] = await sequelize.query(
    `UPDATE ${QC_TABLES.ATTEMPTS}
     SET status = :toStatus,
         failureReason = COALESCE(:failureReason, failureReason),
         endedAt = CASE
           WHEN :toStatus IN ('missed','rejected','busy','offline','cancelled','failed','ended')
           THEN COALESCE(endedAt, NOW())
           ELSE endedAt
         END,
         acceptedAt = CASE WHEN :toStatus = 'accepted' THEN NOW() ELSE acceptedAt END,
         connectedAt = CASE WHEN :toStatus = 'connected' THEN NOW() ELSE connectedAt END,
         updatedAt = NOW()
         ${extraSetSql}
     WHERE id = :attemptId
       AND status = :fromStatus`,
    {
      replacements: {
        attemptId: Number(attemptId),
        fromStatus,
        toStatus,
        failureReason,
      },
    }
  );

  return Number(metadata?.affectedRows ?? 0) > 0;
};

export const handleQuickConnectAttemptFailure = async ({
  attemptId,
  terminalStatus,
  failureReason,
}) => {
  const attempt = await fetchAttemptById(attemptId);

  if (!attempt) {
    return { handled: false };
  }

  const updated = await transitionAttemptStatus({
    attemptId,
    fromStatus: ATTEMPT_STATUS.RINGING,
    toStatus: terminalStatus,
    failureReason,
  });

  if (!updated) {
    return { handled: false, reason: "not_ringing" };
  }

  const session = await fetchSessionById(attempt.sessionId);

  if (!session || session.status !== SESSION_STATUS.ROUTING) {
    return { handled: false, reason: "session_not_routing" };
  }

  return finalizeFailedAttempt({
    attempt,
    session,
    terminalStatus,
    failureReason,
  });
};

export const tryAcceptQuickConnectAttempt = async ({
  attemptId,
  callerId,
  receiverId,
}) => {
  const attempt = await fetchAttemptById(attemptId);

  if (!attempt) {
    return { accepted: false, reason: "unavailable" };
  }

  const session = await fetchSessionById(attempt.sessionId);

  if (!session) {
    return { accepted: false, reason: "session_ended" };
  }

  if (
    session.status === SESSION_STATUS.CANCELLED ||
    session.status === SESSION_STATUS.ENDED ||
    session.status === SESSION_STATUS.FAILED
  ) {
    return { accepted: false, reason: "cancelled" };
  }

  if (session.status !== SESSION_STATUS.ROUTING) {
    return { accepted: false, reason: "session_ended" };
  }

  if (
    Number(session.callerId) !== Number(callerId) ||
    Number(attempt.receiverId) !== Number(receiverId)
  ) {
    return { accepted: false, reason: "unavailable" };
  }

  if (attempt.status !== ATTEMPT_STATUS.RINGING) {
    return {
      accepted: false,
      reason: attempt.status === ATTEMPT_STATUS.ACCEPTED ? "already_handled" : "expired",
    };
  }

  const [, acceptMeta] = await sequelize.query(
    `UPDATE ${QC_TABLES.ATTEMPTS}
     SET status = :acceptedStatus,
         acceptedAt = NOW(3),
         updatedAt = NOW(3)
     WHERE id = :attemptId
       AND status = :ringingStatus
       AND ringExpiresAt > NOW(3)`,
    {
      replacements: {
        attemptId: Number(attemptId),
        acceptedStatus: ATTEMPT_STATUS.ACCEPTED,
        ringingStatus: ATTEMPT_STATUS.RINGING,
      },
    }
  );

  const affectedRows = Number(acceptMeta?.affectedRows ?? 0);

  if (affectedRows <= 0) {
    return { accepted: false, reason: "expired" };
  }

  await sequelize.query(
    `UPDATE ${QC_TABLES.SESSIONS}
     SET status = :connectingStatus,
         updatedAt = NOW(3)
     WHERE id = :sessionId
       AND status = :routingStatus`,
    {
      replacements: {
        sessionId: Number(session.id),
        connectingStatus: SESSION_STATUS.CONNECTING,
        routingStatus: SESSION_STATUS.ROUTING,
      },
    }
  );

  if (attempt.callHistoryId) {
    await CallHistory.update(
      { status: "accepted" },
      { where: { id: attempt.callHistoryId } }
    );
  }

  await releaseCreatorReservation({
    creatorId: attempt.receiverId,
    sessionId: session.id,
    attemptId: attempt.id,
  });

  await logQuickConnectEvent("call_accepted", {
    sessionId: session.id,
    attemptId: attempt.id,
    callId: attempt.callHistoryId,
    callerId,
    receiverId,
    deliveryEvent: "ACCEPTED",
  });

  return {
    accepted: true,
    reason: null,
    sessionId: session.id,
    attemptId: attempt.id,
    callHistoryId: attempt.callHistoryId,
  };
};

export const buildQuickConnectAcceptAck = (acceptResult) => ({
  accepted: Boolean(acceptResult?.accepted),
  reason: acceptResult?.accepted
    ? null
    : mapAcceptFailureReason(acceptResult?.reason),
  sessionId: acceptResult?.sessionId
    ? String(acceptResult.sessionId)
    : undefined,
  attemptId: acceptResult?.attemptId
    ? String(acceptResult.attemptId)
    : undefined,
  mode: CALL_MODES.QUICK_CONNECT,
});

export const markQuickConnectConnected = async ({ callHistoryId }) => {
  const attempt = await fetchAttemptByCallHistoryId(callHistoryId);

  if (!attempt) {
    return false;
  }

  await transitionAttemptStatus({
    attemptId: attempt.id,
    fromStatus: ATTEMPT_STATUS.ACCEPTED,
    toStatus: ATTEMPT_STATUS.CONNECTED,
  });

  await sequelize.query(
    `UPDATE ${QC_TABLES.SESSIONS}
     SET status = :connectedStatus,
         connectedAt = NOW(),
         connectedCallHistoryId = :callHistoryId,
         updatedAt = NOW()
     WHERE id = :sessionId`,
    {
      replacements: {
        sessionId: Number(attempt.sessionId),
        connectedStatus: SESSION_STATUS.CONNECTED,
        callHistoryId: Number(callHistoryId),
      },
    }
  );

  if (attempt.callHistoryId) {
    await CallHistory.update(
      { status: "ongoing" },
      { where: { id: attempt.callHistoryId } }
    );
  }

  await logQuickConnectEvent("call_connected", {
    sessionId: attempt.sessionId,
    attemptId: attempt.id,
    callId: callHistoryId,
    deliveryEvent: "ACCEPTED",
  });

  return true;
};

export const cancelQuickConnectSession = async ({
  sessionId,
  callerId,
}) => {
  const session = await fetchSessionById(sessionId);

  if (!session) {
    return { cancelled: false, reason: "not_found" };
  }

  if (Number(session.callerId) !== Number(callerId)) {
    return { cancelled: false, reason: "forbidden" };
  }

  if (
    session.status === SESSION_STATUS.CANCELLED ||
    session.status === SESSION_STATUS.ENDED ||
    session.status === SESSION_STATUS.CONNECTED
  ) {
    return { cancelled: true, alreadyTerminal: true };
  }

  await sequelize.query(
    `UPDATE ${QC_TABLES.SESSIONS}
     SET status = :cancelledStatus,
         endedAt = NOW(),
         updatedAt = NOW()
     WHERE id = :sessionId
       AND status IN ('routing', 'connecting')`,
    {
      replacements: {
        sessionId: Number(sessionId),
        cancelledStatus: SESSION_STATUS.CANCELLED,
      },
    }
  );

  const activeAttempts = await sequelize.query(
    `SELECT *
     FROM ${QC_TABLES.ATTEMPTS}
     WHERE sessionId = :sessionId
       AND status IN ('created', 'ringing', 'accepted')`,
    {
      replacements: { sessionId: Number(sessionId) },
      type: QueryTypes.SELECT,
    }
  );

  for (const attempt of activeAttempts) {
    await transitionAttemptStatus({
      attemptId: attempt.id,
      fromStatus: attempt.status,
      toStatus: ATTEMPT_STATUS.CANCELLED,
      failureReason: "caller_cancelled",
    });

    await releaseCreatorReservation({
      creatorId: attempt.receiverId,
      sessionId,
      attemptId: attempt.id,
    });

    if (attempt.callHistoryId) {
      await CallHistory.update(
        {
          status: "cancelled",
          duration: 0,
          coinsSpent: 0,
        },
        {
          where: { id: attempt.callHistoryId },
        }
      );
    }

    emitToCreator(attempt.receiverId, "call-cancelled", {
      callerId: String(session.callerId),
      receiverId: String(attempt.receiverId),
      callId: attempt.callHistoryId ? String(attempt.callHistoryId) : undefined,
      sessionId: String(sessionId),
      attemptId: String(attempt.id),
      reason: "caller_cancelled",
    });
  }

  await logQuickConnectEvent("call_session_cancelled", {
    sessionId,
    callerId,
    deliveryEvent: "FAILED",
  });

  return { cancelled: true };
};

export const resolveQuickConnectContext = async ({
  callId = null,
  sessionId = null,
  attemptId = null,
}) => {
  if (attemptId) {
    const attempt = await fetchAttemptById(attemptId);
    if (attempt) {
      const session = await fetchSessionById(attempt.sessionId);
      return { attempt, session, mode: CALL_MODES.QUICK_CONNECT };
    }
  }

  if (callId) {
    const attempt = await fetchAttemptByCallHistoryId(callId);
    if (attempt) {
      const session = await fetchSessionById(attempt.sessionId);
      return { attempt, session, mode: CALL_MODES.QUICK_CONNECT };
    }
  }

  if (sessionId) {
    const session = await fetchSessionById(sessionId);
    if (session?.mode === CALL_MODES.QUICK_CONNECT) {
      return { attempt: null, session, mode: CALL_MODES.QUICK_CONNECT };
    }
  }

  return { attempt: null, session: null, mode: CALL_MODES.DIRECT };
};

export const processExpiredQuickConnectAttempts = async () => {
  await ensureQuickConnectSchema();
  await releaseExpiredReservations();

  const expiredAttempts = await sequelize.query(
    `SELECT ca.*
     FROM ${QC_TABLES.ATTEMPTS} ca
     INNER JOIN ${QC_TABLES.SESSIONS} cs ON cs.id = ca.sessionId
     WHERE ca.status = :ringingStatus
       AND ca.ringExpiresAt <= NOW(3)
       AND cs.status = :routingStatus
     ORDER BY ca.ringExpiresAt ASC
     LIMIT 25`,
    {
      replacements: {
        ringingStatus: ATTEMPT_STATUS.RINGING,
        routingStatus: SESSION_STATUS.ROUTING,
      },
      type: QueryTypes.SELECT,
    }
  );

  for (const attempt of expiredAttempts) {
    const updated = await transitionAttemptStatus({
      attemptId: attempt.id,
      fromStatus: ATTEMPT_STATUS.RINGING,
      toStatus: ATTEMPT_STATUS.MISSED,
      failureReason: "timeout",
    });

    if (!updated) {
      continue;
    }

    const session = await fetchSessionById(attempt.sessionId);

    await logQuickConnectEvent("call_timeout", {
      sessionId: attempt.sessionId,
      attemptId: attempt.id,
      callId: attempt.callHistoryId,
      callerId: session?.callerId,
      receiverId: attempt.receiverId,
      deliveryEvent: "MISSED",
    });

    await finalizeFailedAttempt({
      attempt,
      session,
      terminalStatus: ATTEMPT_STATUS.MISSED,
      failureReason: "timeout",
    });
  }

  const expiredSessions = await sequelize.query(
    `SELECT id, callerId
     FROM ${QC_TABLES.SESSIONS}
     WHERE status = :routingStatus
       AND deadlineAt <= NOW()`,
    {
      replacements: { routingStatus: SESSION_STATUS.ROUTING },
      type: QueryTypes.SELECT,
    }
  );

  for (const session of expiredSessions) {
    await markSessionEnded({
      sessionId: session.id,
      status: SESSION_STATUS.ENDED,
    });

    emitToCaller(session.callerId, "call-session-ended", {
      sessionId: String(session.id),
      reason: "deadline_exceeded",
      status: SESSION_STATUS.ENDED,
    });
  }
};

export const handleQuickConnectCreatorOffline = async ({
  attemptId,
}) => {
  return handleQuickConnectAttemptFailure({
    attemptId,
    terminalStatus: ATTEMPT_STATUS.OFFLINE,
    failureReason: "offline",
  });
};

export const handleQuickConnectCreatorBusy = async ({
  attemptId,
}) => {
  return handleQuickConnectAttemptFailure({
    attemptId,
    terminalStatus: ATTEMPT_STATUS.BUSY,
    failureReason: "busy",
  });
};

export const handleCreatorDisconnectedDuringQuickConnect = async (creatorId) => {
  const attempts = await sequelize.query(
    `SELECT ca.id
     FROM ${QC_TABLES.ATTEMPTS} ca
     INNER JOIN ${QC_TABLES.SESSIONS} cs ON cs.id = ca.sessionId
     WHERE ca.receiverId = :creatorId
       AND ca.status = :ringingStatus
       AND cs.status = :routingStatus`,
    {
      replacements: {
        creatorId: Number(creatorId),
        ringingStatus: ATTEMPT_STATUS.RINGING,
        routingStatus: SESSION_STATUS.ROUTING,
      },
      type: QueryTypes.SELECT,
    }
  );

  for (const row of attempts) {
    await handleQuickConnectCreatorOffline({
      attemptId: row.id,
    });
  }
};

export const handleQuickConnectCreatorRejected = async ({
  attemptId,
}) => {
  const result = await handleQuickConnectAttemptFailure({
    attemptId,
    terminalStatus: ATTEMPT_STATUS.REJECTED,
    failureReason: "rejected",
  });

  return result;
};

export const getAttemptByCallHistoryId = fetchAttemptByCallHistoryId;

export const __testables = {
  selectEligibleCreator,
  fetchSessionById,
  fetchAttemptById,
  getQuickConnectSettings,
  fetchRungCreatorIdsForSession,
  validateCreatorBeforeRing,
  mapAcceptFailureReason,
  cleanupRingAttemptOnError,
};
