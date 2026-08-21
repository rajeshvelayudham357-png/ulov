import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { QC_TABLES } from "../constants/quickConnect.js";
import { ensureColumn } from "./schemaUtil.service.js";

let schemaReady = false;

const tableExists = async (tableName) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS tableCount
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.tableCount ?? 0) > 0;
};

export const ensureQuickConnectSchema = async ({ force = false } = {}) => {
  if (schemaReady && !force) {
    return;
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${QC_TABLES.SESSIONS} (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      callerId BIGINT NOT NULL,
      callType VARCHAR(16) NOT NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'quick_connect',
      preferredReceiverId BIGINT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'routing',
      maxAttempts INT NOT NULL DEFAULT 3,
      attemptCount INT NOT NULL DEFAULT 0,
      connectedCallHistoryId BIGINT NULL,
      startedAt DATETIME NULL,
      connectedAt DATETIME NULL,
      endedAt DATETIME NULL,
      deadlineAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_call_sessions_caller (callerId),
      INDEX idx_call_sessions_status (status),
      INDEX idx_call_sessions_deadline (deadlineAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${QC_TABLES.ATTEMPTS} (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      sessionId BIGINT NOT NULL,
      receiverId BIGINT NOT NULL,
      callHistoryId BIGINT NULL,
      attemptNumber INT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'created',
      ringStartedAt DATETIME NULL,
      ringExpiresAt DATETIME NULL,
      acceptedAt DATETIME NULL,
      connectedAt DATETIME NULL,
      endedAt DATETIME NULL,
      failureReason VARCHAR(64) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_call_attempts_session (sessionId),
      INDEX idx_call_attempts_receiver (receiverId),
      INDEX idx_call_attempts_status (status),
      INDEX idx_call_attempts_ring_expires (ringExpiresAt),
      INDEX idx_call_attempts_call_history (callHistoryId),
      UNIQUE KEY uniq_session_attempt_number (sessionId, attemptNumber)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${QC_TABLES.RESERVATIONS} (
      creatorId BIGINT NOT NULL PRIMARY KEY,
      sessionId BIGINT NOT NULL,
      attemptId BIGINT NOT NULL,
      expiresAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_creator_reservations_session (sessionId),
      INDEX idx_creator_reservations_expires (expiresAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (!(await tableExists("users"))) {
    schemaReady = true;
    return;
  }

  await ensureColumn(
    "users",
    "acceptAutoRoutedCalls",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );

  try {
    await sequelize.query(
      `ALTER TABLE ${QC_TABLES.ATTEMPTS}
       MODIFY ringStartedAt DATETIME(3) NULL,
       MODIFY ringExpiresAt DATETIME(3) NULL`
    );
  } catch (error) {
    console.log(`Quick Connect datetime precision migration skipped: ${error.message}`);
  }

  try {
    await sequelize.query(
      `ALTER TABLE ${QC_TABLES.RESERVATIONS}
       MODIFY expiresAt DATETIME(3) NOT NULL`
    );
  } catch (error) {
    console.log(`Reservation datetime precision migration skipped: ${error.message}`);
  }

  schemaReady = true;
  console.log("Quick Connect schema ready");
};
