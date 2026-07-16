import { QueryTypes } from "sequelize";
import { Op } from "sequelize";
import { sequelize } from "../config/database.js";
import { Wallet, WalletTransaction } from "../models/index.js";

export const SPIN_PRIZES = [
  {
    key: "none",
    label: "Better luck next time",
    coins: 0,
    segmentIndex: 0,
  },
  {
    key: "10",
    label: "10 Coins",
    coins: 10,
    segmentIndex: 1,
  },
  {
    key: "20",
    label: "20 Coins",
    coins: 20,
    segmentIndex: 2,
  },
  {
    key: "50",
    label: "50 Coins",
    coins: 50,
    segmentIndex: 3,
  },
  {
    key: "1000",
    label: "1000 Coins",
    coins: 1000,
    segmentIndex: 4,
  },
];

export const serializePrize = (prize) => ({
  key: String(prize.key),
  label: String(prize.label),
  coins: Number(prize.coins) || 0,
  segmentIndex: Number(prize.segmentIndex) || 0,
});

export const getAvailablePrizes = ({
  winningPercentage,
  hasWonBonus,
}) => {
  if (hasWonBonus) {
    return [serializePrize(SPIN_PRIZES[0])];
  }

  const maxCoins = getMaxPrizeCoins(winningPercentage);

  return SPIN_PRIZES.filter(
    (prize) =>
      prize.coins === 0 || prize.coins <= maxCoins
  ).map(serializePrize);
};

const DEFAULT_SETTINGS = {
  winningPercentage: 40,
  spinCost: 5,
  freeSpinsPerDay: 1,
  enabled: 1,
};

let settingsTableReady = false;
let stateTableReady = false;
let historyTableReady = false;
let userSettingsTableReady = false;

const ensureSpinSettingsTable = async () => {
  if (settingsTableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_spin_settings (
id TINYINT NOT NULL PRIMARY KEY,
winningPercentage FLOAT NOT NULL DEFAULT 40,
spinCost INT NOT NULL DEFAULT 5,
freeSpinsPerDay INT NOT NULL DEFAULT 1,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_spin_settings
(id, winningPercentage, spinCost, freeSpinsPerDay)
VALUES (1, :winningPercentage, :spinCost, :freeSpinsPerDay)`,
    {
      replacements: DEFAULT_SETTINGS,
    }
  );

  const enabledColumns = await sequelize.query(
    `SHOW COLUMNS FROM admin_spin_settings LIKE 'enabled'`,
    {
      type: QueryTypes.SELECT,
    }
  );

  if (!enabledColumns.length) {
    await sequelize.query(
      `ALTER TABLE admin_spin_settings
ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1`
    );
  }

  settingsTableReady = true;
};

const ensureSpinStateTable = async () => {
  if (stateTableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_spin_state (
userId BIGINT NOT NULL PRIMARY KEY,
hasWonBonus TINYINT(1) NOT NULL DEFAULT 0,
lastFreeSpinDate DATE NULL,
lastSpinAt DATETIME NULL,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  stateTableReady = true;
};

const ensureSpinHistoryTable = async () => {
  if (historyTableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_spin_history (
id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
userId BIGINT NOT NULL,
prizeKey VARCHAR(32) NOT NULL,
coinsWon INT NOT NULL DEFAULT 0,
usedFreeSpin TINYINT(1) NOT NULL DEFAULT 0,
spinCost INT NOT NULL DEFAULT 0,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`
  );

  historyTableReady = true;
};

const ensureUserSpinSettingsTable = async () => {
  if (userSettingsTableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_spin_settings (
userId BIGINT NOT NULL PRIMARY KEY,
winningPercentage FLOAT NULL,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
  );

  userSettingsTableReady = true;
};

const getUserCustomWinningPercentage = async (userId) => {
  await ensureUserSpinSettingsTable();

  const rows = await sequelize.query(
    `SELECT winningPercentage
FROM user_spin_settings
WHERE userId = :userId
LIMIT 1`,
    {
      replacements: { userId },
      type: QueryTypes.SELECT,
    }
  );

  if (
    !rows[0] ||
    rows[0].winningPercentage === null ||
    rows[0].winningPercentage === undefined
  ) {
    return null;
  }

  return clampPercentage(rows[0].winningPercentage);
};

export const getEffectiveSpinSettings = async (userId) => {
  const globalSettings = await getSpinSettings();
  const customPercentage =
    await getUserCustomWinningPercentage(userId);

  const winningPercentage =
    customPercentage === null
      ? globalSettings.winningPercentage
      : customPercentage;

  return {
    ...globalSettings,
    winningPercentage,
    globalWinningPercentage:
      globalSettings.winningPercentage,
    customWinningPercentage: customPercentage,
    usesCustomPercentage: customPercentage !== null,
    maxPrizeCoins: getMaxPrizeCoins(winningPercentage),
    enabled: globalSettings.enabled,
  };
};

export const getMaleUserSpinSettings = async () => {
  await ensureUserSpinSettingsTable();

  const globalSettings = await getSpinSettings();

  const rows = await sequelize.query(
    `SELECT
users.id,
users.publicUserId,
users.name,
users.nickname,
users.username,
users.phone,
users.avatar,
user_spin_settings.winningPercentage AS customWinningPercentage,
user_spin_settings.updatedAt AS customUpdatedAt,
user_spin_state.hasWonBonus,
user_spin_state.lastSpinAt
FROM users
LEFT JOIN user_spin_settings
ON user_spin_settings.userId = users.id
LEFT JOIN user_spin_state
ON user_spin_state.userId = users.id
WHERE users.gender = 'Male'
ORDER BY users.createdAt DESC`,
    {
      type: QueryTypes.SELECT,
    }
  );

  return rows.map((row) => {
    const customPercentage =
      row.customWinningPercentage === null ||
      row.customWinningPercentage === undefined
        ? null
        : clampPercentage(row.customWinningPercentage);

    const effectivePercentage =
      customPercentage === null
        ? globalSettings.winningPercentage
        : customPercentage;

    return {
      id: row.id,
      publicUserId: row.publicUserId,
      name:
        row.nickname ||
        (row.name && row.name !== "New User"
          ? row.name
          : null) ||
        row.username ||
        row.phone ||
        "Unknown",
      phone: row.phone,
      avatar: row.avatar,
      globalWinningPercentage:
        globalSettings.winningPercentage,
      customWinningPercentage: customPercentage,
      effectiveWinningPercentage: effectivePercentage,
      maxPrizeCoins: getMaxPrizeCoins(
        effectivePercentage
      ),
      usesCustomPercentage: customPercentage !== null,
      hasWonBonus: Boolean(Number(row.hasWonBonus)),
      lastSpinAt: row.lastSpinAt || null,
      updatedAt: row.customUpdatedAt || null,
    };
  });
};

export const updateMaleUserSpinPercentage = async (
  userId,
  winningPercentage
) => {
  await ensureUserSpinSettingsTable();

  const userRows = await sequelize.query(
    `SELECT id, gender
FROM users
WHERE id = :userId
LIMIT 1`,
    {
      replacements: { userId },
      type: QueryTypes.SELECT,
    }
  );

  if (!userRows[0]) {
    throw new Error("User not found");
  }

  if (String(userRows[0].gender) !== "Male") {
    throw new Error(
      "Spin wheel overrides are for male users only"
    );
  }

  if (
    winningPercentage === null ||
    winningPercentage === undefined ||
    winningPercentage === ""
  ) {
    await sequelize.query(
      `DELETE FROM user_spin_settings
WHERE userId = :userId`,
      {
        replacements: { userId },
      }
    );

    return getMaleUserSpinSettings().then((users) =>
      users.find((item) => item.id === userId)
    );
  }

  const value = clampPercentage(winningPercentage);

  await sequelize.query(
    `INSERT INTO user_spin_settings
(userId, winningPercentage)
VALUES (:userId, :winningPercentage)
ON DUPLICATE KEY UPDATE
winningPercentage = :winningPercentage`,
    {
      replacements: {
        userId,
        winningPercentage: value,
      },
    }
  );

  return getMaleUserSpinSettings().then((users) =>
    users.find((item) => item.id === userId)
  );
};

const clampPercentage = (value) =>
  Math.min(
    100,
    Math.max(
      0,
      Number.isFinite(Number(value))
        ? Number(value)
        : DEFAULT_SETTINGS.winningPercentage
    )
  );

const getTodayDate = () =>
  new Date().toISOString().slice(0, 10);

export const getMaxPrizeCoins = (winningPercentage) => {
  const pct = clampPercentage(winningPercentage);

  if (pct <= 0) {
    return 0;
  }

  if (pct >= 99) {
    return 1000;
  }

  if (pct >= 85) {
    return 50;
  }

  if (pct >= 80) {
    return 20;
  }

  if (pct >= 40) {
    return 10;
  }

  return 0;
};

const pickWeightedPrize = (maxCoins) => {
  const candidates = SPIN_PRIZES.filter(
    (prize) =>
      prize.coins > 0 && prize.coins <= maxCoins
  );

  if (!candidates.length) {
    return SPIN_PRIZES[0];
  }

  const weights = candidates.map((prize) => {
    if (prize.coins >= 1000) {
      return 2;
    }

    if (prize.coins >= 50) {
      return 10;
    }

    if (prize.coins >= 20) {
      return 22;
    }

    return 66;
  });

  const totalWeight = weights.reduce(
    (sum, weight) => sum + weight,
    0
  );
  let roll = Math.random() * totalWeight;

  for (let index = 0; index < candidates.length; index += 1) {
    roll -= weights[index];

    if (roll <= 0) {
      return candidates[index];
    }
  }

  return candidates[candidates.length - 1];
};

export const resolveSpinResult = ({
  winningPercentage,
  hasWonBonus,
}) => {
  if (hasWonBonus) {
    return serializePrize(SPIN_PRIZES[0]);
  }

  const pct = clampPercentage(winningPercentage);

  if (pct <= 0) {
    return serializePrize(SPIN_PRIZES[0]);
  }

  const roll = Math.random() * 100;

  if (roll > pct) {
    return serializePrize(SPIN_PRIZES[0]);
  }

  const maxCoins = getMaxPrizeCoins(pct);

  if (maxCoins <= 0) {
    return serializePrize(SPIN_PRIZES[0]);
  }

  return serializePrize(
    pickWeightedPrize(maxCoins)
  );
};

export const getSpinSettings = async () => {
  await ensureSpinSettingsTable();

  const rows = await sequelize.query(
    "SELECT * FROM admin_spin_settings WHERE id = 1 LIMIT 1",
    {
      type: QueryTypes.SELECT,
    }
  );

  const row = rows[0] || DEFAULT_SETTINGS;

  const winningPercentage = clampPercentage(
    row.winningPercentage
  );

  return {
    enabled: Boolean(
      Number(row.enabled ?? DEFAULT_SETTINGS.enabled)
    ),
    winningPercentage,
    spinCost:
      Number(row.spinCost) > 0
        ? Number(row.spinCost)
        : DEFAULT_SETTINGS.spinCost,
    freeSpinsPerDay:
      Number(row.freeSpinsPerDay) > 0
        ? Number(row.freeSpinsPerDay)
        : DEFAULT_SETTINGS.freeSpinsPerDay,
    maxPrizeCoins: getMaxPrizeCoins(winningPercentage),
    updatedAt: row.updatedAt || null,
  };
};

const serializeSpinSettings = (settings) => ({
  enabled:
    settings.enabled === undefined
      ? true
      : Boolean(settings.enabled),
  winningPercentage:
    Number(settings.winningPercentage) || 0,
  spinCost: Number(settings.spinCost) || DEFAULT_SETTINGS.spinCost,
  freeSpinsPerDay:
    Number(settings.freeSpinsPerDay) ||
    DEFAULT_SETTINGS.freeSpinsPerDay,
  maxPrizeCoins:
    Number(settings.maxPrizeCoins) ||
    getMaxPrizeCoins(settings.winningPercentage),
  globalWinningPercentage:
    settings.globalWinningPercentage === undefined
      ? undefined
      : Number(settings.globalWinningPercentage) || 0,
  customWinningPercentage:
    settings.customWinningPercentage === null ||
    settings.customWinningPercentage === undefined
      ? null
      : Number(settings.customWinningPercentage) || 0,
  usesCustomPercentage: Boolean(
    settings.usesCustomPercentage
  ),
  updatedAt: settings.updatedAt || null,
});

export const updateSpinSettings = async ({
  enabled,
  winningPercentage,
  spinCost,
  freeSpinsPerDay,
}) => {
  await ensureSpinSettingsTable();

  const current = await getSpinSettings();

  const next = {
    enabled:
      enabled === undefined
        ? current.enabled
          ? 1
          : 0
        : enabled
          ? 1
          : 0,
    winningPercentage:
      winningPercentage === undefined
        ? current.winningPercentage
        : clampPercentage(winningPercentage),
    spinCost:
      spinCost === undefined
        ? current.spinCost
        : Math.max(1, Number(spinCost) || DEFAULT_SETTINGS.spinCost),
    freeSpinsPerDay:
      freeSpinsPerDay === undefined
        ? current.freeSpinsPerDay
        : Math.max(
            1,
            Number(freeSpinsPerDay) ||
              DEFAULT_SETTINGS.freeSpinsPerDay
          ),
  };

  await sequelize.query(
    `UPDATE admin_spin_settings
SET enabled = :enabled,
winningPercentage = :winningPercentage,
spinCost = :spinCost,
freeSpinsPerDay = :freeSpinsPerDay
WHERE id = 1`,
    {
      replacements: next,
    }
  );

  return getSpinSettings();
};

export const getSpinWheelPublicConfig = async () => {
  const settings = await getSpinSettings();

  return {
    enabled: settings.enabled,
    updatedAt: settings.updatedAt || null,
  };
};

export const ensureSpinWheelEnabled = async () => {
  const settings = await getSpinSettings();

  if (!settings.enabled) {
    throw new Error("Spin wheel is currently disabled");
  }

  return settings;
};

const getOrCreateWallet = async (userId) => {
  let wallet = await Wallet.findOne({
    where: { userId },
  });

  if (!wallet) {
    wallet = await Wallet.create({
      userId,
      balance: 0,
    });
  }

  return wallet;
};

const getOrCreateSpinState = async (userId) => {
  await ensureSpinStateTable();

  const rows = await sequelize.query(
    "SELECT * FROM user_spin_state WHERE userId = :userId LIMIT 1",
    {
      replacements: { userId },
      type: QueryTypes.SELECT,
    }
  );

  if (rows[0]) {
    return rows[0];
  }

  await sequelize.query(
    `INSERT INTO user_spin_state (userId, hasWonBonus)
VALUES (:userId, 0)`,
    {
      replacements: { userId },
    }
  );

  return {
    userId,
    hasWonBonus: 0,
    lastFreeSpinDate: null,
    lastSpinAt: null,
  };
};

export const getSpinStatus = async (userId) => {
  await ensureSpinHistoryTable();

  const settings = await getEffectiveSpinSettings(userId);
  const state = await getOrCreateSpinState(userId);
  const wallet = await getOrCreateWallet(userId);
  await wallet.reload();
  const today = getTodayDate();
  const freeSpinAvailable =
    state.lastFreeSpinDate !== today;
  const hasWonBonus = Boolean(Number(state.hasWonBonus));
  const serializedSettings =
    serializeSpinSettings(settings);

  return {
    enabled: serializedSettings.enabled,
    settings: serializedSettings,
    prizes: SPIN_PRIZES.map(serializePrize),
    availablePrizes: getAvailablePrizes({
      winningPercentage:
        serializedSettings.winningPercentage,
      hasWonBonus,
    }),
    balance: Number(wallet.balance) || 0,
    hasWonBonus,
    freeSpinAvailable,
    canSpin:
      freeSpinAvailable ||
      Number(wallet.balance) >=
        serializedSettings.spinCost,
    lastFreeSpinDate: state.lastFreeSpinDate,
  };
};

const creditWallet = async (userId, amount, description) => {
  const creditAmount = Number(amount) || 0;

  if (creditAmount <= 0) {
    return getOrCreateWallet(userId);
  }

  const wallet = await getOrCreateWallet(userId);

  wallet.balance =
    Number(wallet.balance) + creditAmount;
  await wallet.save();
  await wallet.reload();

  await WalletTransaction.create({
    userId,
    type: "credit",
    amount: creditAmount,
    description,
  });

  return wallet;
};

const debitWallet = async (userId, amount, description) => {
  const spendAmount = Number(amount);

  const [updatedCount] = await Wallet.update(
    {
      balance: sequelize.literal(
        `balance - ${spendAmount}`
      ),
    },
    {
      where: {
        userId,
        balance: {
          [Op.gte]: spendAmount,
        },
      },
    }
  );

  if (!updatedCount) {
    throw new Error("Low balance");
  }

  const wallet = await getOrCreateWallet(userId);
  await wallet.reload();

  await WalletTransaction.create({
    userId,
    type: "debit",
    amount: spendAmount,
    description,
  });

  return wallet;
};

export const performSpin = async (userId) => {
  await ensureSpinHistoryTable();
  await ensureSpinWheelEnabled();

  const settings = await getEffectiveSpinSettings(userId);
  const state = await getOrCreateSpinState(userId);
  const today = getTodayDate();
  const freeSpinAvailable =
    state.lastFreeSpinDate !== today;
  const hasWonBonus = Boolean(Number(state.hasWonBonus));

  let usedFreeSpin = false;
  let spinCost = 0;

  if (freeSpinAvailable) {
    usedFreeSpin = true;
  } else {
    spinCost = settings.spinCost;
    await debitWallet(
      userId,
      spinCost,
      "Spin wheel play"
    );
  }

  const prize = resolveSpinResult({
    winningPercentage: settings.winningPercentage,
    hasWonBonus,
  });
  const coinsWon = Number(prize.coins) || 0;

  let wallet = await getOrCreateWallet(userId);
  await wallet.reload();

  if (coinsWon > 0 && !hasWonBonus) {
    wallet = await creditWallet(
      userId,
      coinsWon,
      `Spin wheel win (${coinsWon} coins)`
    );

    await sequelize.query(
      `UPDATE user_spin_state
SET hasWonBonus = 1,
lastFreeSpinDate = :lastFreeSpinDate,
lastSpinAt = NOW()
WHERE userId = :userId`,
      {
        replacements: {
          userId,
          lastFreeSpinDate: usedFreeSpin
            ? today
            : state.lastFreeSpinDate,
        },
      }
    );
  } else {
    await sequelize.query(
      `UPDATE user_spin_state
SET lastFreeSpinDate = :lastFreeSpinDate,
lastSpinAt = NOW()
WHERE userId = :userId`,
      {
        replacements: {
          userId,
          lastFreeSpinDate: usedFreeSpin
            ? today
            : state.lastFreeSpinDate,
        },
      }
    );
  }

  await sequelize.query(
    `INSERT INTO user_spin_history
(userId, prizeKey, coinsWon, usedFreeSpin, spinCost)
VALUES (:userId, :prizeKey, :coinsWon, :usedFreeSpin, :spinCost)`,
    {
      replacements: {
        userId,
        prizeKey: prize.key,
        coinsWon,
        usedFreeSpin: usedFreeSpin ? 1 : 0,
        spinCost,
      },
    }
  );

  const nextStatus = await getSpinStatus(userId);
  const finalWallet = await getOrCreateWallet(userId);
  await finalWallet.reload();

  return {
    prize,
    coinsWon,
    usedFreeSpin,
    spinCost,
    walletBalance: Number(finalWallet.balance) || 0,
    hasWonBonus: nextStatus.hasWonBonus,
    freeSpinAvailable: nextStatus.freeSpinAvailable,
    canSpin: nextStatus.canSpin,
    settings: nextStatus.settings,
    availablePrizes: nextStatus.availablePrizes,
  };
};
