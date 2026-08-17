import { getAppSettings } from "../services/appSettings.service.js";

export const GOLD_PACKAGES = [
  { id: 1, coins: 40, price: 19 },
  { id: 2, coins: 80, price: 39 },
  { id: 3, coins: 160, price: 69 },
  { id: 4, coins: 320, price: 129 },
  { id: 5, coins: 1000, price: 249 },
  { id: 6, coins: 1300, price: 389 },
  { id: 7, coins: 1700, price: 499 },
  { id: 8, coins: 2100, price: 599 },
  { id: 9, coins: 2400, price: 699 },
];

export const BONUS_PACKAGE_DEFAULTS = [
  {
    id: 101,
    slot: 1,
    defaultEnabled: false,
    defaultPrice: 49,
    defaultCoins: 120,
    badge: "BONUS",
  },
  {
    id: 102,
    slot: 2,
    defaultEnabled: false,
    defaultPrice: 249,
    defaultCoins: 1200,
    badge: "MEGA BONUS",
  },
  {
    id: 103,
    slot: 3,
    defaultEnabled: false,
    defaultPrice: 549,
    defaultCoins: 2000,
    badge: "ULTIMATE BONUS",
  },
];

const bonusSettingsKey = (slot, field) => {
  const keys = {
    1: {
      enabled: "bonusPack1Enabled",
      price: "bonusPack1Price",
      coins: "bonusPack1Coins",
    },
    2: {
      enabled: "bonusPack2Enabled",
      price: "bonusPack2Price",
      coins: "bonusPack2Coins",
    },
    3: {
      enabled: "bonusPack3Enabled",
      price: "bonusPack3Price",
      coins: "bonusPack3Coins",
    },
  };

  return keys[slot]?.[field];
};

export const buildBonusPackagesFromSettings = (settings = {}) =>
  BONUS_PACKAGE_DEFAULTS.flatMap((slotDef) => {
    const enabledKey = bonusSettingsKey(slotDef.slot, "enabled");
    const priceKey = bonusSettingsKey(slotDef.slot, "price");
    const coinsKey = bonusSettingsKey(slotDef.slot, "coins");

    const enabled = Boolean(Number(settings?.[enabledKey] ?? 0));
    if (!enabled) {
      return [];
    }

    const price = Number(settings?.[priceKey] ?? slotDef.defaultPrice);
    const coins = Number(settings?.[coinsKey] ?? slotDef.defaultCoins);

    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(coins) || coins <= 0) {
      return [];
    }

    return [
      {
        id: slotDef.id,
        coins: Math.round(coins),
        price: Math.round(price),
        isBonus: true,
        badge: slotDef.badge,
        slot: slotDef.slot,
      },
    ];
  });

export const getGoldPackageById = (packageId, bonusPackages = []) => {
  const id = Number(packageId);
  const regular = GOLD_PACKAGES.find((item) => item.id === id);
  if (regular) {
    return regular;
  }

  return bonusPackages.find((item) => item.id === id) || null;
};

export const resolveGoldPackageById = async (packageId) => {
  const settings = await getAppSettings();
  const bonusPackages = buildBonusPackagesFromSettings(settings);
  return getGoldPackageById(packageId, bonusPackages);
};

export const getEnabledBonusPackages = async () => {
  const settings = await getAppSettings();
  return buildBonusPackagesFromSettings(settings);
};

export const getAllPurchasablePackages = async () => {
  const bonusPackages = await getEnabledBonusPackages();
  return {
    regular: GOLD_PACKAGES,
    bonus: bonusPackages,
  };
};
