import { QueryTypes } from "sequelize";

import {
  USER_LEVEL_GENDERS,
  buildDefaultLevelConfigRows,
} from "../constants/userLevel.js";
import { sequelize } from "../config/database.js";

export const USER_LEVEL_CONFIG_TABLE = "user_level_config";

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

const seedGenderDefaults = async (gender) => {
  const [countRow] = await sequelize.query(
    `SELECT COUNT(*) AS total
     FROM ${USER_LEVEL_CONFIG_TABLE}
     WHERE gender = :gender`,
    {
      replacements: { gender },
      type: QueryTypes.SELECT,
    }
  );

  if (Number(countRow?.total || 0) > 0) {
    return;
  }

  const defaults = buildDefaultLevelConfigRows(gender);

  for (const row of defaults) {
    await sequelize.query(
      `INSERT INTO ${USER_LEVEL_CONFIG_TABLE}
       (gender, levelNumber, tier, minimumCoins, displayName, theme, visualHeight, badgeIcon, themeColor, isActive)
       VALUES
       (:gender, :levelNumber, :tier, :minimumCoins, :displayName, :theme, :visualHeight, :badgeIcon, :themeColor, :isActive)`,
      {
        replacements: row,
      }
    );
  }
};

export const ensureUserLevelSchema = async ({ force = false } = {}) => {
  if (schemaReady && !force) {
    return;
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${USER_LEVEL_CONFIG_TABLE} (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      gender VARCHAR(16) NOT NULL,
      levelNumber TINYINT NOT NULL,
      tier VARCHAR(20) NOT NULL,
      minimumCoins BIGINT NOT NULL DEFAULT 0,
      displayName VARCHAR(120) NOT NULL,
      theme VARCHAR(32) NOT NULL,
      visualHeight TINYINT NOT NULL DEFAULT 0,
      badgeIcon VARCHAR(512) NULL,
      themeColor VARCHAR(32) NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_level_gender_level (gender, levelNumber),
      INDEX idx_user_level_gender_min_coins (gender, minimumCoins)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (!(await indexExists(USER_LEVEL_CONFIG_TABLE, "idx_user_level_gender_min_coins"))) {
    try {
      await sequelize.query(
        `CREATE INDEX idx_user_level_gender_min_coins
         ON ${USER_LEVEL_CONFIG_TABLE} (gender, minimumCoins)`
      );
    } catch (error) {
      console.log(`User level config index skipped: ${error.message}`);
    }
  }

  try {
    const earningsIndexExists = await indexExists("earnings", "idx_earnings_user_call");
    if (!earningsIndexExists && (await tableExists("earnings"))) {
      await sequelize.query(
        `CREATE INDEX idx_earnings_user_call ON earnings (userId, callId)`
      );
    }
  } catch (error) {
    console.log(`Earnings user level index skipped: ${error.message}`);
  }

  try {
    const paymentIndexExists = await indexExists(
      "payment_orders",
      "idx_payment_orders_user_status"
    );
    if (!paymentIndexExists && (await tableExists("payment_orders"))) {
      await sequelize.query(
        `CREATE INDEX idx_payment_orders_user_status
         ON payment_orders (userId, status)`
      );
    }
  } catch (error) {
    console.log(`Payment orders user level index skipped: ${error.message}`);
  }

  await seedGenderDefaults(USER_LEVEL_GENDERS.FEMALE);
  await seedGenderDefaults(USER_LEVEL_GENDERS.MALE);

  schemaReady = true;
};
