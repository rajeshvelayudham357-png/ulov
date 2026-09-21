import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

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

const ensureIndex = async (tableName, indexName, columnsSql) => {
  if (await indexExists(tableName, indexName)) {
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
      console.log(`Revenue index skipped for ${tableName}.${indexName}: ${message}`);
      return;
    }
    throw error;
  }
};

/** Indexes that speed up admin revenue dashboards. */
export const ensureAdminRevenueIndexes = async () => {
  if (indexesReady) {
    return;
  }

  await ensureIndex(
    "payment_orders",
    "idx_po_status_updated_at",
    "`status`, `updatedAt`"
  );
  await ensureIndex(
    "payment_orders",
    "idx_po_status_updated_user",
    "`status`, `updatedAt`, `userId`"
  );
  await ensureIndex(
    "wallet_transactions",
    "idx_wt_user_amount",
    "`userId`, `amount`"
  );
  await ensureIndex(
    "wallet_transactions",
    "idx_wt_user_created_at",
    "`userId`, `createdAt`"
  );
  await ensureIndex(
    "withdraws",
    "idx_withdraws_status_updated_at",
    "`status`, `updatedAt`"
  );
  await ensureIndex(
    "earnings",
    "idx_earnings_user_created_at",
    "`userId`, `createdAt`"
  );

  indexesReady = true;
};
