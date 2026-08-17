import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

let tableReady = false;

export const DEFAULT_GROWTH_THRESHOLDS = {
  minAvgCallDurationSec: 30,
  minCreatorAnswerRatePct: 70,
  minPayerConversionPct: 20,
  minRepeatPayerRatePct: 30,
  minOnlineCreators: 5,
  maxRevenueDropPct: 15,
  maxCallFailureRatePct: 35,
  minCallSuccessRatePct: 40,
  minHealthyOnlineCreators: 10,
  revenueGrowthPositivePct: 5,
};

const ensureColumn = async (tableName, columnName, columnDefinition) => {
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

  if (Number(rows[0]?.columnCount ?? 0) === 0) {
    await sequelize.query(
      `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`
    );
  }
};

export const ensureAdminGrowthThresholdsTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_growth_thresholds (
      id TINYINT NOT NULL PRIMARY KEY,
      minAvgCallDurationSec INT NOT NULL DEFAULT 30,
      minCreatorAnswerRatePct DECIMAL(5,2) NOT NULL DEFAULT 70.00,
      minPayerConversionPct DECIMAL(5,2) NOT NULL DEFAULT 20.00,
      minRepeatPayerRatePct DECIMAL(5,2) NOT NULL DEFAULT 30.00,
      minOnlineCreators INT NOT NULL DEFAULT 5,
      maxRevenueDropPct DECIMAL(5,2) NOT NULL DEFAULT 15.00,
      maxCallFailureRatePct DECIMAL(5,2) NOT NULL DEFAULT 35.00,
      minCallSuccessRatePct DECIMAL(5,2) NOT NULL DEFAULT 40.00,
      minHealthyOnlineCreators INT NOT NULL DEFAULT 10,
      revenueGrowthPositivePct DECIMAL(5,2) NOT NULL DEFAULT 5.00,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await ensureColumn(
    "admin_growth_thresholds",
    "minCallSuccessRatePct",
    "DECIMAL(5,2) NOT NULL DEFAULT 40.00"
  );
  await ensureColumn(
    "admin_growth_thresholds",
    "minHealthyOnlineCreators",
    "INT NOT NULL DEFAULT 10"
  );
  await ensureColumn(
    "admin_growth_thresholds",
    "revenueGrowthPositivePct",
    "DECIMAL(5,2) NOT NULL DEFAULT 5.00"
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_growth_thresholds (id) VALUES (1)`
  );

  tableReady = true;
};

export const getGrowthThresholds = async () => {
  await ensureAdminGrowthThresholdsTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_growth_thresholds WHERE id = 1 LIMIT 1",
    { type: QueryTypes.SELECT }
  );

  const row = rows[0] || {};

  return {
    minAvgCallDurationSec:
      Number(row.minAvgCallDurationSec) ||
      DEFAULT_GROWTH_THRESHOLDS.minAvgCallDurationSec,
    minCreatorAnswerRatePct:
      Number(row.minCreatorAnswerRatePct) ||
      DEFAULT_GROWTH_THRESHOLDS.minCreatorAnswerRatePct,
    minPayerConversionPct:
      Number(row.minPayerConversionPct) ||
      DEFAULT_GROWTH_THRESHOLDS.minPayerConversionPct,
    minRepeatPayerRatePct:
      Number(row.minRepeatPayerRatePct) ||
      DEFAULT_GROWTH_THRESHOLDS.minRepeatPayerRatePct,
    minOnlineCreators:
      Number(row.minOnlineCreators) ||
      DEFAULT_GROWTH_THRESHOLDS.minOnlineCreators,
    maxRevenueDropPct:
      Number(row.maxRevenueDropPct) ||
      DEFAULT_GROWTH_THRESHOLDS.maxRevenueDropPct,
    maxCallFailureRatePct:
      Number(row.maxCallFailureRatePct) ||
      DEFAULT_GROWTH_THRESHOLDS.maxCallFailureRatePct,
    minCallSuccessRatePct:
      Number(row.minCallSuccessRatePct) ||
      DEFAULT_GROWTH_THRESHOLDS.minCallSuccessRatePct,
    minHealthyOnlineCreators:
      Number(row.minHealthyOnlineCreators) ||
      DEFAULT_GROWTH_THRESHOLDS.minHealthyOnlineCreators,
    revenueGrowthPositivePct:
      Number(row.revenueGrowthPositivePct) ||
      DEFAULT_GROWTH_THRESHOLDS.revenueGrowthPositivePct,
  };
};
