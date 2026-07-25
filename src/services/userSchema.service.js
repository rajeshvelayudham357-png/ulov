import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

let userSchemaReady = false;

const columnExists = async (tableName, columnName) => {
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

const backfillAccountStatus = async () => {
  await sequelize.query(
    `UPDATE users
SET accountStatus = 'approved'
WHERE gender = 'Female'
AND verified = 1
AND (accountStatus IS NULL OR accountStatus = '')`
  );

  await sequelize.query(
    `UPDATE users
SET accountStatus = 'active'
WHERE (gender IS NULL OR gender != 'Female')
AND (accountStatus IS NULL OR accountStatus = '')`
  );
};

export const ensureUserSchema = async ({ force = false } = {}) => {
  if (userSchemaReady && !force) {
    return;
  }

  await ensureColumn("users", "verificationAudioUrl", "TEXT NULL");
  await ensureColumn("users", "verificationSentence", "VARCHAR(255) NULL");
  await ensureColumn("users", "verificationVideoUrl", "TEXT NULL");
  await ensureColumn(
    "users",
    "accountStatus",
    "VARCHAR(20) NOT NULL DEFAULT 'pending'"
  );
  await ensureColumn(
    "users",
    "blocked",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );
  await ensureColumn("users", "publicUserId", "VARCHAR(8) NULL");
  await ensureColumn(
    "users",
    "acceptVoiceCalls",
    "TINYINT(1) NOT NULL DEFAULT 1"
  );
  await ensureColumn(
    "users",
    "acceptVideoCalls",
    "TINYINT(1) NOT NULL DEFAULT 1"
  );
  await ensureColumn(
    "users",
    "welcomeOfferClaimed",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );
  await ensureColumn(
    "users",
    "notificationsEnabled",
    "TINYINT(1) NOT NULL DEFAULT 1"
  );
  await ensureColumn(
    "users",
    "phoneVerified",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );
  await ensureColumn("users", "loginPinHash", "VARCHAR(255) NULL");
  await ensureColumn("users", "rejectionReasons", "TEXT NULL");

  try {
    await sequelize.query(
      "ALTER TABLE users ADD UNIQUE INDEX users_publicUserId_unique (publicUserId)"
    );
  } catch (error) {
    // Index already exists.
  }

  await backfillAccountStatus();

  userSchemaReady = true;

  console.log("User schema ready");
};
