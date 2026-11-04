import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

// Additive only: new nullable columns and an index. Historical rows keep their
// values; NULL means "settled before Phase 1".
const CALL_HISTORY_COLUMNS = [
  ["acceptedAt", "DATETIME NULL"],
  ["endedAt", "DATETIME NULL"],
  ["settledAt", "DATETIME NULL"],
  ["collectedCoins", "INT NULL"],
  ["endReason", "VARCHAR(40) NULL"],
  // Phase 2: who charges this call ('client' | 'shadow' | 'server'); NULL = client.
  ["billingMode", "VARCHAR(16) NULL"],
  // Phase 2: per-minute rate fixed when the call was created.
  ["billingRatePerMinute", "DECIMAL(10,2) NULL"],
  // Phase 2: billable seconds accrued by the server (pauses with the face gate).
  ["billableSeconds", "INT NULL"],
];

// Phase 2: one row per prepaid interval; the unique key makes a repeated charge
// for the same interval impossible. shadow = 1 rows are computed, never debited.
const CREATE_INTERVALS_TABLE = `CREATE TABLE IF NOT EXISTS \`call_billing_intervals\` (
  \`id\` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  \`callId\` INT NOT NULL,
  \`intervalIndex\` INT NOT NULL,
  \`shadow\` TINYINT(1) NOT NULL DEFAULT 0,
  \`coversFromSecond\` INT NOT NULL,
  \`coversToSecond\` INT NOT NULL,
  \`amount\` INT NOT NULL,
  \`walletTransactionId\` INT NULL,
  \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY \`uniq_call_interval\` (\`callId\`, \`intervalIndex\`, \`shadow\`),
  KEY \`idx_cbi_call\` (\`callId\`)
)`;

let schemaReady = false;

const columnExists = async (tableName, columnName) => {
  const rows = await sequelize.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND COLUMN_NAME = :columnName
     LIMIT 1`,
    { replacements: { tableName, columnName }, type: QueryTypes.SELECT }
  );

  return rows.length > 0;
};

const indexExists = async (tableName, indexName) => {
  const rows = await sequelize.query(
    `SELECT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND INDEX_NAME = :indexName
     LIMIT 1`,
    { replacements: { tableName, indexName }, type: QueryTypes.SELECT }
  );

  return rows.length > 0;
};

export const ensureCallBillingSchema = async ({ force = false } = {}) => {
  if (schemaReady && !force) {
    return;
  }

  for (const [columnName, definition] of CALL_HISTORY_COLUMNS) {
    if (!(await columnExists("call_histories", columnName))) {
      await sequelize.query(
        `ALTER TABLE \`call_histories\` ADD COLUMN \`${columnName}\` ${definition}`
      );
    }
  }

  if (
    (await columnExists("wallet_transactions", "referenceId")) &&
    (await columnExists("wallet_transactions", "referenceType")) &&
    !(await indexExists("wallet_transactions", "idx_wt_reference"))
  ) {
    await sequelize.query(
      "CREATE INDEX `idx_wt_reference` ON `wallet_transactions` (`referenceType`, `referenceId`)"
    );
  }

  await sequelize.query(CREATE_INTERVALS_TABLE);

  // Quick Connect sessions decide billing once for all their attempts.
  const [qcTable] = await sequelize.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quick_connect_sessions' LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  if (qcTable && !(await columnExists("quick_connect_sessions", "billingMode"))) {
    await sequelize.query(
      "ALTER TABLE `quick_connect_sessions` ADD COLUMN `billingMode` VARCHAR(16) NULL"
    );
  }

  // Re-check later if Quick Connect's table is created after this ran.
  schemaReady = Boolean(qcTable);
};
