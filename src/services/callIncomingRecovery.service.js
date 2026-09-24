import { Op } from "sequelize";

import { CallHistory, User } from "../models/index.js";
import { generateAgoraToken } from "./agora.service.js";
import { getAdminUserDisplayName } from "./adminUsers.service.js";
import {
  getChannelNameForCall,
} from "./callState.service.js";

export const PENDING_INCOMING_CALL_STATUSES = ["live", "ringing"];

/** Align with female ring timeout + buffer; stale rows must not replay on app open. */
export const MAX_PENDING_INCOMING_AGE_MS = 120_000;

export const isIncomingCallWithinDeliveryWindow = (call) => {
  if (!call) {
    return false;
  }

  const createdAt =
    call.createdAt instanceof Date
      ? call.createdAt.getTime()
      : new Date(call.createdAt).getTime();

  if (!Number.isFinite(createdAt)) {
    return false;
  }

  return Date.now() - createdAt <= MAX_PENDING_INCOMING_AGE_MS;
};

export const findPendingIncomingCallForReceiver = async (receiverId) => {
  const normalizedReceiverId = Number(receiverId);

  if (!Number.isFinite(normalizedReceiverId) || normalizedReceiverId <= 0) {
    return null;
  }

  const minCreatedAt = new Date(Date.now() - MAX_PENDING_INCOMING_AGE_MS);

  return CallHistory.findOne({
    where: {
      receiverId: normalizedReceiverId,
      status: {
        [Op.in]: PENDING_INCOMING_CALL_STATUSES,
      },
      createdAt: {
        [Op.gte]: minCreatedAt,
      },
    },
    order: [["createdAt", "DESC"]],
  });
};

export const buildPendingIncomingCallPayload = async (call, receiverId) => {
  if (!call) {
    return null;
  }

  const normalizedReceiverId = Number(receiverId);
  const row = call.toJSON ? call.toJSON() : call;

  if (Number(row.receiverId) !== normalizedReceiverId) {
    return null;
  }

  const caller = await User.findByPk(row.callerId, {
    attributes: ["id", "name", "nickname", "username", "avatar", "publicUserId"],
  });

  const channelName = getChannelNameForCall(row.id);
  const receiverToken = await generateAgoraToken(
    channelName,
    normalizedReceiverId
  );

  const dbType = String(row.type || "video").toLowerCase();
  const callType = dbType === "voice" ? "voice" : "video";
  const typeParam = callType === "voice" ? "audio" : callType;

  return {
    active: true,
    type: "incoming_call",
    serverRouted: true,
    callId: String(row.id),
    callerId: String(row.callerId),
    receiverId: String(normalizedReceiverId),
    callerName: caller ? getAdminUserDisplayName(caller) : "Incoming call",
    avatar: caller?.avatar || "",
    channelName,
    token: receiverToken,
    uid: String(normalizedReceiverId),
    callType,
    typeParam,
    status: String(row.status || ""),
  };
};

export const getPendingIncomingCallForReceiver = async (receiverId) => {
  const call = await findPendingIncomingCallForReceiver(receiverId);

  if (!call) {
    return {
      active: false,
    };
  }

  const payload = await buildPendingIncomingCallPayload(call, receiverId);

  if (!payload) {
    return {
      active: false,
    };
  }

  return payload;
};
