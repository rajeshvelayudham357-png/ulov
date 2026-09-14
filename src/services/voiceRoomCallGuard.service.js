import { Op } from "sequelize";

import { CallHistory } from "../models/index.js";
import { ACTIVE_CALL_STATUSES } from "./callState.service.js";

export const isUserInActiveOneToOneCall = async (userId) => {
  const normalizedUserId = Number(userId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return false;
  }

  const activeCall = await CallHistory.findOne({
    where: {
      status: {
        [Op.in]: ACTIVE_CALL_STATUSES,
      },
      [Op.or]: [
        { callerId: normalizedUserId },
        { receiverId: normalizedUserId },
      ],
    },
    order: [["createdAt", "DESC"]],
  });

  return Boolean(activeCall);
};

export const getActiveOneToOneCallForUser = async (userId) => {
  const normalizedUserId = Number(userId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  return CallHistory.findOne({
    where: {
      status: {
        [Op.in]: ACTIVE_CALL_STATUSES,
      },
      [Op.or]: [
        { callerId: normalizedUserId },
        { receiverId: normalizedUserId },
      ],
    },
    order: [["createdAt", "DESC"]],
  });
};
