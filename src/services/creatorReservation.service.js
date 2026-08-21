import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { ACTIVE_CALL_STATUSES } from "./callState.service.js";

const ACTIVE_STATUS_LIST = ACTIVE_CALL_STATUSES.map((status) => `'${status}'`).join(
  ", "
);

export const releaseCreatorReservation = async ({
  creatorId,
  sessionId = null,
  attemptId = null,
}) => {
  const creatorIdNum = Number(creatorId);

  if (!Number.isFinite(creatorIdNum)) {
    return false;
  }

  const replacements = {
    creatorId: creatorIdNum,
  };

  let whereClause = "creatorId = :creatorId";

  if (sessionId != null) {
    replacements.sessionId = Number(sessionId);
    whereClause += " AND sessionId = :sessionId";
  }

  if (attemptId != null) {
    replacements.attemptId = Number(attemptId);
    whereClause += " AND attemptId = :attemptId";
  }

  await sequelize.query(
    `DELETE FROM creator_call_reservations WHERE ${whereClause}`,
    { replacements }
  );

  return true;
};

export const releaseExpiredReservations = async () => {
  await sequelize.query(
    `DELETE FROM creator_call_reservations WHERE expiresAt <= NOW(3)`
  );
};

export const reserveCreatorAtomically = async ({
  creatorId,
  sessionId,
  attemptId,
  expiresAt,
}) => {
  const creatorIdNum = Number(creatorId);
  const sessionIdNum = Number(sessionId);
  const attemptIdNum = Number(attemptId);

  if (
    !Number.isFinite(creatorIdNum) ||
    !Number.isFinite(sessionIdNum) ||
    !Number.isFinite(attemptIdNum)
  ) {
    return { reserved: false, reason: "invalid_ids" };
  }

  await releaseExpiredReservations();

  const transaction = await sequelize.transaction();

  try {
    const busyRows = await sequelize.query(
      `SELECT id
       FROM call_histories
       WHERE receiverId = :creatorId
         AND status IN (${ACTIVE_STATUS_LIST})
       LIMIT 1
       FOR UPDATE`,
      {
        replacements: { creatorId: creatorIdNum },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    if (busyRows.length > 0) {
      await transaction.rollback();
      return { reserved: false, reason: "busy" };
    }

    const reservationRows = await sequelize.query(
      `SELECT creatorId
       FROM creator_call_reservations
       WHERE creatorId = :creatorId
         AND expiresAt > NOW(3)
       LIMIT 1
       FOR UPDATE`,
      {
        replacements: { creatorId: creatorIdNum },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    if (reservationRows.length > 0) {
      await transaction.rollback();
      return { reserved: false, reason: "already_reserved" };
    }

    await sequelize.query(
      `INSERT INTO creator_call_reservations
       (creatorId, sessionId, attemptId, expiresAt)
       VALUES (:creatorId, :sessionId, :attemptId, :expiresAt)`,
      {
        replacements: {
          creatorId: creatorIdNum,
          sessionId: sessionIdNum,
          attemptId: attemptIdNum,
          expiresAt,
        },
        transaction,
      }
    );

    await transaction.commit();
    return { reserved: true };
  } catch (error) {
    await transaction.rollback();

    if (String(error?.original?.code || error?.code || "") === "ER_DUP_ENTRY") {
      return { reserved: false, reason: "already_reserved" };
    }

    throw error;
  }
};

export const isCreatorReserved = async (creatorId) => {
  const rows = await sequelize.query(
    `SELECT creatorId
     FROM creator_call_reservations
     WHERE creatorId = :creatorId
       AND expiresAt > NOW(3)
     LIMIT 1`,
    {
      replacements: { creatorId: Number(creatorId) },
      type: QueryTypes.SELECT,
    }
  );

  return rows.length > 0;
};
