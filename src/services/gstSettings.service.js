import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";

const DEFAULT_SETTINGS = {
  gstPercent: 18,
};

let tableReady = false;

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const splitInclusiveGst = (inclusiveAmount, gstPercent) => {
  const amount = Number(inclusiveAmount) || 0;
  const rate = Number(gstPercent) || 0;

  if (amount <= 0 || rate <= 0) {
    return {
      inclusiveAmount: roundMoney(amount),
      gstAmount: 0,
      baseRevenue: roundMoney(amount),
      gstPercent: rate,
    };
  }

  const gstAmount = roundMoney((amount * rate) / (100 + rate));
  const baseRevenue = roundMoney(amount - gstAmount);

  return {
    inclusiveAmount: roundMoney(amount),
    gstAmount,
    baseRevenue,
    gstPercent: rate,
  };
};

const ensureGstSettingsTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_gst_settings (
id TINYINT NOT NULL PRIMARY KEY,
gstPercent DECIMAL(5,2) NOT NULL DEFAULT 18.00,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_gst_settings
(id, gstPercent)
VALUES (1, :gstPercent)`,
    {
      replacements: DEFAULT_SETTINGS,
    }
  );

  tableReady = true;
};

export const getGstSettings = async () => {
  await ensureGstSettingsTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_gst_settings WHERE id = 1 LIMIT 1",
    {
      type: QueryTypes.SELECT,
    }
  );

  const row = rows[0] || DEFAULT_SETTINGS;
  const gstPercent = Number(row.gstPercent ?? DEFAULT_SETTINGS.gstPercent);

  return {
    gstPercent: Number.isFinite(gstPercent) ? gstPercent : DEFAULT_SETTINGS.gstPercent,
    updatedAt: row.updatedAt || null,
  };
};

export const updateGstSettings = async ({ gstPercent }) => {
  await ensureGstSettingsTable();

  const parsed = Number(gstPercent);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("GST percentage must be between 0 and 100");
  }

  const nextGstPercent = roundMoney(parsed);

  await sequelize.query(
    `UPDATE admin_gst_settings
SET gstPercent = :gstPercent
WHERE id = 1`,
    {
      replacements: {
        gstPercent: nextGstPercent,
      },
    }
  );

  return getGstSettings();
};
