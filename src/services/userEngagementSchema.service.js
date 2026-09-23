import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

let schemaReady = false;

const indexExists = async (tableName, indexName) => {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND INDEX_NAME = :indexName`,
    { replacements: { tableName, indexName }, type: QueryTypes.SELECT }
  );

  return Number(row?.count ?? 0) > 0;
};

export const ensureUserEngagementStatsSchema = async () => {
  if (schemaReady) {
    return;
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS user_engagement_stats (
      userId BIGINT NOT NULL,
      last_meaningful_activity_at DATETIME NULL,
      last_app_open_at DATETIME NULL,
      last_session_started_at DATETIME NULL,
      last_creator_profile_viewed_at DATETIME NULL,
      last_chat_at DATETIME NULL,
      last_call_at DATETIME NULL,
      last_recharge_at DATETIME NULL,
      last_auth_login_at DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (userId)
    )
  `);

  if (!(await indexExists("user_engagement_stats", "idx_ues_meaningful_activity"))) {
    try {
      await sequelize.query(`
        CREATE INDEX idx_ues_meaningful_activity
        ON user_engagement_stats (last_meaningful_activity_at)
      `);
    } catch (error) {
      console.log(
        "user_engagement_stats index skipped:",
        error.message
      );
    }
  }

  schemaReady = true;
};
