import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

let broadcastSchemaReady = false;

const columnExists = async (tableName, columnName) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS columnCount
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME = :tableName
AND COLUMN_NAME = :columnName`,
    {
      replacements: { tableName, columnName },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.columnCount ?? 0) > 0;
};

const ensureColumn = async (tableName, columnName, definition) => {
  const exists = await columnExists(tableName, columnName);

  if (exists) {
    return;
  }

  await sequelize.query(
    `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
  );

  console.log(`Added column ${tableName}.${columnName}`);
};

export const ensureBroadcastSchema = async () => {
  if (broadcastSchemaReady) {
    return;
  }

  await ensureColumn(
    "broadcasts",
    "targetAudience",
    "VARCHAR(20) NULL DEFAULT 'female'"
  );

  await ensureColumn(
    "broadcasts",
    "targetLanguage",
    "VARCHAR(40) NULL"
  );

  broadcastSchemaReady = true;
};
