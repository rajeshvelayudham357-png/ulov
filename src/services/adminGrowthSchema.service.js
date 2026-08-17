import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { ensureAdminGrowthThresholdsTable } from "./adminGrowthThresholds.service.js";

let indexesReady = false;

const indexExists = async (tableName, indexName) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS indexCount
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND INDEX_NAME = :indexName`,
    {
      replacements: { tableName, indexName },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.indexCount ?? 0) > 0;
};

const columnIndexExists = async (tableName, columnName) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS indexCount
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND COLUMN_NAME = :columnName
       AND SEQ_IN_INDEX = 1`,
    {
      replacements: { tableName, columnName },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.indexCount ?? 0) > 0;
};

const ensureIndex = async (tableName, indexName, columnsSql, leadingColumn) => {
  if (await indexExists(tableName, indexName)) {
    return;
  }

  if (leadingColumn && (await columnIndexExists(tableName, leadingColumn))) {
    return;
  }

  try {
    await sequelize.query(
      `CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columnsSql})`
    );
  } catch (error) {
    const message = String(error?.message || error);
    if (
      message.includes("Too many keys") ||
      message.includes("Duplicate key name")
    ) {
      console.log(`Growth index skipped for ${tableName}.${indexName}: ${message}`);
      return;
    }
    throw error;
  }
};

export const ensureGrowthAnalyticsIndexes = async () => {
  if (indexesReady) {
    return;
  }

  await ensureAdminGrowthThresholdsTable();

  await ensureIndex(
    "call_histories",
    "idx_ch_created_at",
    "`createdAt`",
    "createdAt"
  );
  await ensureIndex(
    "call_histories",
    "idx_ch_status_created_at",
    "`status`, `createdAt`",
    "status"
  );
  await ensureIndex(
    "call_histories",
    "idx_ch_caller_created_at",
    "`callerId`, `createdAt`",
    "callerId"
  );
  await ensureIndex(
    "call_histories",
    "idx_ch_receiver_created_at",
    "`receiverId`, `createdAt`",
    "receiverId"
  );

  await ensureIndex(
    "payment_orders",
    "idx_po_status_updated_at",
    "`status`, `updatedAt`",
    "status"
  );

  await ensureIndex("users", "idx_users_created_at", "`createdAt`", "createdAt");
  await ensureIndex("users", "idx_users_last_seen", "`lastSeen`", "lastSeen");
  await ensureIndex(
    "users",
    "idx_users_last_login_at",
    "`lastLoginAt`",
    "lastLoginAt"
  );

  indexesReady = true;
};
