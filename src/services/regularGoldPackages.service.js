import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { getAppSettings } from "./appSettings.service.js";

export const REGULAR_PACKAGE_DEFAULTS = [
  {
    id: 1,
    slot: 1,
    title: "Starter Pack",
    defaultEnabled: true,
    defaultPrice: 19,
    defaultCoins: 40,
  },
  {
    id: 2,
    slot: 2,
    title: "Value Pack",
    defaultEnabled: true,
    defaultPrice: 39,
    defaultCoins: 80,
  },
  {
    id: 3,
    slot: 3,
    title: "Saver Pack",
    defaultEnabled: true,
    defaultPrice: 69,
    defaultCoins: 160,
  },
  {
    id: 4,
    slot: 4,
    title: "Popular Pack",
    defaultEnabled: true,
    defaultPrice: 129,
    defaultCoins: 320,
  },
  {
    id: 5,
    slot: 5,
    title: "Best Seller",
    defaultEnabled: true,
    defaultPrice: 249,
    defaultCoins: 1000,
  },
  {
    id: 6,
    slot: 6,
    title: "Premium Pack",
    defaultEnabled: true,
    defaultPrice: 389,
    defaultCoins: 1300,
  },
  {
    id: 7,
    slot: 7,
    title: "Mega Pack",
    defaultEnabled: true,
    defaultPrice: 499,
    defaultCoins: 1700,
  },
  {
    id: 8,
    slot: 8,
    title: "Elite Pack",
    defaultEnabled: true,
    defaultPrice: 599,
    defaultCoins: 2100,
  },
  {
    id: 9,
    slot: 9,
    title: "Ultimate Pack",
    defaultEnabled: true,
    defaultPrice: 699,
    defaultCoins: 2400,
  },
];

const regularSettingsKey = (slot, field) => {
  const keys = {
    enabled: `regularPack${slot}Enabled`,
    price: `regularPack${slot}Price`,
    coins: `regularPack${slot}Coins`,
  };

  return keys[field];
};

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
};

let columnsReady = false;

const ensureRegularPackColumns = async () => {
  if (columnsReady) {
    return;
  }

  await getAppSettings();

  for (const slotDef of REGULAR_PACKAGE_DEFAULTS) {
    const slot = slotDef.slot;
    const enabledDefault = slotDef.defaultEnabled ? 1 : 0;

    await ensureColumn(
      "admin_app_settings",
      regularSettingsKey(slot, "enabled"),
      `TINYINT(1) NOT NULL DEFAULT ${enabledDefault}`
    );
    await ensureColumn(
      "admin_app_settings",
      regularSettingsKey(slot, "price"),
      `INT NOT NULL DEFAULT ${slotDef.defaultPrice}`
    );
    await ensureColumn(
      "admin_app_settings",
      regularSettingsKey(slot, "coins"),
      `INT NOT NULL DEFAULT ${slotDef.defaultCoins}`
    );
  }

  columnsReady = true;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
};

export const readRegularPackSettingsRow = async () => {
  await ensureRegularPackColumns();

  const columns = REGULAR_PACKAGE_DEFAULTS.flatMap((slotDef) => [
    regularSettingsKey(slotDef.slot, "enabled"),
    regularSettingsKey(slotDef.slot, "price"),
    regularSettingsKey(slotDef.slot, "coins"),
  ]).join(", ");

  const rows = await sequelize.query(
    `SELECT ${columns}, updatedAt FROM admin_app_settings WHERE id = 1 LIMIT 1`,
    {
      type: QueryTypes.SELECT,
    }
  );

  return rows[0] || {};
};

export const buildRegularPackagesFromSettings = (settings = {}) =>
  REGULAR_PACKAGE_DEFAULTS.flatMap((slotDef) => {
    const enabledKey = regularSettingsKey(slotDef.slot, "enabled");
    const priceKey = regularSettingsKey(slotDef.slot, "price");
    const coinsKey = regularSettingsKey(slotDef.slot, "coins");

    const enabled = Boolean(
      Number(settings?.[enabledKey] ?? (slotDef.defaultEnabled ? 1 : 0))
    );

    if (!enabled) {
      return [];
    }

    const price = Number(settings?.[priceKey] ?? slotDef.defaultPrice);
    const coins = Number(settings?.[coinsKey] ?? slotDef.defaultCoins);

    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(coins) ||
      coins <= 0
    ) {
      return [];
    }

    return [
      {
        id: slotDef.id,
        coins: Math.round(coins),
        price: Math.round(price),
      },
    ];
  });

export const getRegularGoldPackagesForAdmin = async () => {
  const row = await readRegularPackSettingsRow();

  return {
    packs: REGULAR_PACKAGE_DEFAULTS.map((slotDef) => {
      const enabledKey = regularSettingsKey(slotDef.slot, "enabled");
      const priceKey = regularSettingsKey(slotDef.slot, "price");
      const coinsKey = regularSettingsKey(slotDef.slot, "coins");

      return {
        id: slotDef.id,
        slot: slotDef.slot,
        title: slotDef.title,
        enabled: Boolean(
          Number(row?.[enabledKey] ?? (slotDef.defaultEnabled ? 1 : 0))
        ),
        price:
          Number(row?.[priceKey] ?? slotDef.defaultPrice) || slotDef.defaultPrice,
        coins:
          Number(row?.[coinsKey] ?? slotDef.defaultCoins) || slotDef.defaultCoins,
        defaultPrice: slotDef.defaultPrice,
        defaultCoins: slotDef.defaultCoins,
      };
    }),
    updatedAt: row?.updatedAt || null,
  };
};

export const updateRegularGoldPackages = async (packs = []) => {
  if (!Array.isArray(packs) || packs.length === 0) {
    const error = new Error("At least one pack is required");
    error.statusCode = 400;
    throw error;
  }

  await ensureRegularPackColumns();
  const currentRow = await readRegularPackSettingsRow();

  const nextValues = {};
  const slotMap = new Map(
    REGULAR_PACKAGE_DEFAULTS.map((slotDef) => [slotDef.slot, slotDef])
  );

  for (const pack of packs) {
    const slot = Number(pack?.slot);
    const slotDef = slotMap.get(slot);

    if (!slotDef) {
      const error = new Error(`Invalid pack slot: ${pack?.slot}`);
      error.statusCode = 400;
      throw error;
    }

    const enabledKey = regularSettingsKey(slot, "enabled");
    const priceKey = regularSettingsKey(slot, "price");
    const coinsKey = regularSettingsKey(slot, "coins");

    const currentEnabled = Boolean(
      Number(
        currentRow?.[enabledKey] ?? (slotDef.defaultEnabled ? 1 : 0)
      )
    );
    const currentPrice =
      Number(currentRow?.[priceKey] ?? slotDef.defaultPrice) ||
      slotDef.defaultPrice;
    const currentCoins =
      Number(currentRow?.[coinsKey] ?? slotDef.defaultCoins) ||
      slotDef.defaultCoins;

    nextValues[enabledKey] =
      pack.enabled === undefined ? (currentEnabled ? 1 : 0) : pack.enabled ? 1 : 0;
    nextValues[priceKey] =
      pack.price === undefined
        ? currentPrice
        : parsePositiveInt(pack.price, currentPrice);
    nextValues[coinsKey] =
      pack.coins === undefined
        ? currentCoins
        : parsePositiveInt(pack.coins, currentCoins);
  }

  const setClause = Object.keys(nextValues)
    .map((key) => `\`${key}\` = :${key}`)
    .join(", ");

  await sequelize.query(
    `UPDATE admin_app_settings
SET ${setClause}, updatedAt = NOW()
WHERE id = 1`,
    {
      replacements: nextValues,
    }
  );

  return getRegularGoldPackagesForAdmin();
};

export const getEnabledRegularPackages = async () => {
  const row = await readRegularPackSettingsRow();
  return buildRegularPackagesFromSettings(row);
};
