import jwt from "jsonwebtoken";

import { CallHistory } from "../models/index.js";

/**
 * Socket.IO identity.
 *
 * `optional` (default): sockets that present a valid JWT are bound to that
 * user and every call event is checked against it. Sockets without a token
 * (app builds released before the handshake token) still connect and act as
 * the user they register as, so existing installs keep receiving calls.
 *
 * `required`: connections without a valid JWT are refused. Switch to this only
 * after the app build that sends the token is the minimum supported version.
 */
export const SOCKET_AUTH_MODES = {
  OPTIONAL: "optional",
  REQUIRED: "required",
};

export const getSocketAuthMode = () =>
  String(process.env.SOCKET_AUTH_MODE || "").trim().toLowerCase() ===
  SOCKET_AUTH_MODES.REQUIRED
    ? SOCKET_AUTH_MODES.REQUIRED
    : SOCKET_AUTH_MODES.OPTIONAL;

const normalizeUserId = (value) => {
  const text = String(value ?? "").trim();

  if (!text || text === "undefined" || text === "null") {
    return null;
  }

  const id = Number(text);
  return Number.isInteger(id) && id > 0 ? String(id) : null;
};

const readHandshakeToken = (handshake = {}) => {
  const header = handshake.headers?.authorization;
  const fromHeader =
    typeof header === "string" && header.toLowerCase().startsWith("bearer ")
      ? header.slice(7)
      : null;

  const token =
    handshake.auth?.token || fromHeader || handshake.query?.token || "";

  return String(token).trim() || null;
};

export const verifySocketToken = (token) => {
  if (!token || !process.env.JWT_SECRET) {
    return null;
  }

  try {
    return normalizeUserId(jwt.verify(token, process.env.JWT_SECRET)?.id);
  } catch {
    return null;
  }
};

export const createSocketAuthMiddleware =
  ({ mode } = {}) =>
  (socket, next) => {
    const userId = verifySocketToken(readHandshakeToken(socket.handshake));

    socket.data.userId = userId;
    socket.data.authenticated = Boolean(userId);
    socket.data.registeredUserId = null;

    if (!userId && (mode ?? getSocketAuthMode()) === SOCKET_AUTH_MODES.REQUIRED) {
      const error = new Error("unauthorized");
      error.data = { code: "SOCKET_UNAUTHORIZED" };
      return next(error);
    }

    return next();
  };

export const isSocketAuthenticated = (socket) =>
  Boolean(socket?.data?.authenticated && socket?.data?.userId);

/** The user a socket acts as: its JWT user, or the id a legacy socket registered. */
export const getSocketActorId = (socket) =>
  isSocketAuthenticated(socket)
    ? socket.data.userId
    : socket?.data?.registeredUserId ?? null;

/**
 * Which user a `register-user` event may bind this socket to. An authenticated
 * socket can only register as itself; a mismatching payload is ignored.
 */
export const resolveRegisterUserId = (socket, payloadUserId) => {
  if (isSocketAuthenticated(socket)) {
    return socket.data.userId;
  }

  return normalizeUserId(payloadUserId);
};

const sameId = (left, right) =>
  left != null && right != null && String(left) === String(right);

const ROLE_FIELDS = {
  caller: ["callerId"],
  receiver: ["receiverId"],
  participant: ["callerId", "receiverId"],
};

/**
 * Checks that the socket's user is the expected participant of the call named
 * in a call event, and that any referenced call row matches the payload.
 * Returns { allowed, reason, actorId, call }.
 */
export const authorizeCallEvent = async ({ socket, data = {}, role }) => {
  const actorId = getSocketActorId(socket);

  if (!actorId) {
    // Only reachable for legacy sockets that never registered (optional mode).
    return {
      allowed: !isSocketAuthenticated(socket) &&
        getSocketAuthMode() === SOCKET_AUTH_MODES.OPTIONAL,
      reason: "unidentified_legacy_socket",
      actorId: null,
      call: null,
    };
  }

  const fields = ROLE_FIELDS[role] ?? ROLE_FIELDS.participant;

  if (!fields.some((field) => sameId(actorId, data[field]))) {
    return { allowed: false, reason: "not_participant", actorId, call: null };
  }

  const callId = Number(data.callHistoryId ?? data.callId);
  let call = null;

  if (Number.isInteger(callId) && callId > 0) {
    call = await CallHistory.findByPk(callId, {
      attributes: ["id", "callerId", "receiverId", "status", "acceptedAt"],
    });

    if (
      call &&
      (!sameId(call.callerId, data.callerId) ||
        !sameId(call.receiverId, data.receiverId))
    ) {
      return { allowed: false, reason: "call_mismatch", actorId, call };
    }
  }

  return { allowed: true, reason: null, actorId, call };
};
