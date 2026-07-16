import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

const DEFAULT_SETTINGS = {
  femaleEarnPercent: 25,
};

let tableReady = false;

const clampPercent = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.femaleEarnPercent;
  }

  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100));
};

export const calculateFemaleGiftEarn = (coinCost, femaleEarnPercent) => {
  const cost = Number(coinCost) || 0;
  const rate = clampPercent(femaleEarnPercent);

  return Math.floor((cost * rate) / 100);
};

const ensureGiftSettingsTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_gift_settings (
id TINYINT NOT NULL PRIMARY KEY,
femaleEarnPercent DECIMAL(5,2) NOT NULL DEFAULT 25.00,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_gift_settings
(id, femaleEarnPercent)
VALUES (1, :femaleEarnPercent)`,
    {
      replacements: DEFAULT_SETTINGS,
    }
  );

  tableReady = true;
};

export const getGiftSettings = async () => {
  await ensureGiftSettingsTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_gift_settings WHERE id = 1 LIMIT 1",
    {
      type: QueryTypes.SELECT,
    }
  );

  const row = rows[0] || DEFAULT_SETTINGS;
  const femaleEarnPercent = clampPercent(
    row.femaleEarnPercent ?? DEFAULT_SETTINGS.femaleEarnPercent
  );

  return {
    femaleEarnPercent,
    updatedAt: row.updatedAt || null,
  };
};

export const updateGiftSettings = async ({ femaleEarnPercent }) => {
  await ensureGiftSettingsTable();

  const nextPercent = clampPercent(femaleEarnPercent);

  if (!Number.isFinite(Number(femaleEarnPercent))) {
    throw new Error("Female gift earn percentage must be between 0 and 100");
  }

  await sequelize.query(
    `UPDATE admin_gift_settings
SET femaleEarnPercent = :femaleEarnPercent
WHERE id = 1`,
    {
      replacements: {
        femaleEarnPercent: nextPercent,
      },
    }
  );

  return getGiftSettings();
};
