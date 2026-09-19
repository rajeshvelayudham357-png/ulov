import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const columnExists = async (tableName, columnName) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS columnCount
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND COLUMN_NAME = :columnName`,
    {
      replacements: {
        tableName,
        columnName,
      },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.columnCount ?? 0) > 0;
};

const isDuplicateColumnError = (error) => {
  const code = String(error?.original?.code || error?.parent?.code || error?.code || "");
  const message = String(error?.message || "");
  return (
    code === "ER_DUP_FIELDNAME" ||
    message.includes("Duplicate column")
  );
};

export const ensureColumn = async (tableName, columnName, definition) => {
  const exists = await columnExists(tableName, columnName);

  if (exists) {
    return;
  }

  try {
    await sequelize.query(
      `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
    );
    console.log(`Added column ${tableName}.${columnName}`);
  } catch (error) {
    if (isDuplicateColumnError(error)) {
      return;
    }

    throw error;
  }
};
