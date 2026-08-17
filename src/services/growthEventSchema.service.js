import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

let schemaReady = false;

const tableExists = async (tableName) => {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName`,
    { replacements: { tableName }, type: QueryTypes.SELECT }
  );
  return Number(row?.count) > 0;
};

const indexExists = async (tableName, indexName) => {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND INDEX_NAME = :indexName`,
    { replacements: { tableName, indexName }, type: QueryTypes.SELECT }
  );
  return Number(row?.count) > 0;
};

const ensureIndex = async (tableName, indexName, columns) => {
  if (await indexExists(tableName, indexName)) {
    return;
  }
  try {
    await sequelize.query(
      `CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columns})`
    );
  } catch (error) {
    if (!String(error.message).includes("Too many keys")) {
      console.log(`Growth index ${indexName} skipped: ${error.message}`);
    }
  }
};

export const ensureGrowthEventSchema = async () => {
  if (schemaReady) {
    return;
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS growth_events (
      id BIGINT NOT NULL AUTO_INCREMENT,
      eventName VARCHAR(64) NOT NULL,
      userId INT NULL,
      creatorId INT NULL,
      anonymousId VARCHAR(64) NULL,
      sessionId VARCHAR(64) NULL,
      idempotencyKey VARCHAR(128) NULL,
      source VARCHAR(255) NULL,
      medium VARCHAR(255) NULL,
      campaign VARCHAR(255) NULL,
      term VARCHAR(255) NULL,
      content VARCHAR(255) NULL,
      referralCode VARCHAR(64) NULL,
      referrerUserId INT NULL,
      platform VARCHAR(32) NULL,
      appVersion VARCHAR(32) NULL,
      deviceType VARCHAR(32) NULL,
      os VARCHAR(64) NULL,
      country VARCHAR(64) NULL,
      language VARCHAR(16) NULL,
      metadata JSON NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_growth_event_idempotency (idempotencyKey),
      KEY idx_growth_events_name_created (eventName, createdAt),
      KEY idx_growth_events_user_created (userId, createdAt),
      KEY idx_growth_events_anonymous_created (anonymousId, createdAt),
      KEY idx_growth_events_creator_created (creatorId, createdAt),
      KEY idx_growth_events_source_created (source, createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS user_attribution (
      id INT NOT NULL AUTO_INCREMENT,
      userId INT NULL,
      anonymousId VARCHAR(64) NULL,
      installId VARCHAR(128) NULL,
      firstTouchSource VARCHAR(255) NULL,
      firstTouchMedium VARCHAR(255) NULL,
      firstTouchCampaign VARCHAR(255) NULL,
      firstTouchTerm VARCHAR(255) NULL,
      firstTouchContent VARCHAR(255) NULL,
      firstTouchReferralCode VARCHAR(64) NULL,
      firstTouchReferrerUserId INT NULL,
      lastTouchSource VARCHAR(255) NULL,
      lastTouchMedium VARCHAR(255) NULL,
      lastTouchCampaign VARCHAR(255) NULL,
      lastTouchTerm VARCHAR(255) NULL,
      lastTouchContent VARCHAR(255) NULL,
      lastTouchReferralCode VARCHAR(64) NULL,
      lastTouchReferrerUserId INT NULL,
      platform VARCHAR(32) NULL,
      appVersion VARCHAR(32) NULL,
      firstTouchAt DATETIME NULL,
      lastTouchAt DATETIME NULL,
      registeredAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_user_attribution_user (userId),
      UNIQUE KEY uniq_user_attribution_anonymous (anonymousId),
      UNIQUE KEY uniq_user_attribution_install (installId),
      KEY idx_user_attribution_first_source (firstTouchSource),
      KEY idx_user_attribution_first_campaign (firstTouchCampaign)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (await tableExists("growth_events")) {
    await ensureIndex(
      "growth_events",
      "idx_growth_events_campaign_created",
      "campaign, createdAt"
    );
  }

  schemaReady = true;
};
