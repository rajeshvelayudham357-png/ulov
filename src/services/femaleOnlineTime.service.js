import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

let dailyTableReady = false;
let totalTableReady = false;

const MAX_DELTA_SECONDS = 300;
const PING_INTERVAL_SECONDS = 30;

const getTodayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

const ensureDailyActivityTable = async () => {
  if (dailyTableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS female_daily_activity (
userId BIGINT NOT NULL,
activityDate DATE NOT NULL,
loggedIn TINYINT(1) NOT NULL DEFAULT 0,
onlineMinutes INT NOT NULL DEFAULT 0,
lastHeartbeatAt DATETIME NULL,
sessionStartedAt DATETIME NULL,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
PRIMARY KEY (userId, activityDate)
)`
  );

  await ensureColumn(
    "female_daily_activity",
    "lastHeartbeatAt",
    "DATETIME NULL"
  );
  await ensureColumn(
    "female_daily_activity",
    "sessionStartedAt",
    "DATETIME NULL"
  );
  await ensureColumn(
    "female_daily_activity",
    "createdAt",
    "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
  );
  await ensureColumn(
    "female_daily_activity",
    "updatedAt",
    "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  );
  await ensureColumn(
    "female_daily_activity",
    "onlineSeconds",
    "INT NOT NULL DEFAULT 0"
  );

  dailyTableReady = true;
};

const ensureTotalOnlineTable = async () => {
  if (totalTableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS female_creator_online_stats (
userId BIGINT NOT NULL PRIMARY KEY,
totalOnlineMinutes BIGINT NOT NULL DEFAULT 0,
lastSessionStartedAt DATETIME NULL,
lastHeartbeatAt DATETIME NULL,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`
  );

  await ensureColumn(
    "female_creator_online_stats",
    "lastSessionStartedAt",
    "DATETIME NULL"
  );
  await ensureColumn(
    "female_creator_online_stats",
    "lastHeartbeatAt",
    "DATETIME NULL"
  );
  await ensureColumn(
    "female_creator_online_stats",
    "createdAt",
    "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
  );
  await ensureColumn(
    "female_creator_online_stats",
    "updatedAt",
    "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  );
  await ensureColumn(
    "female_creator_online_stats",
    "totalOnlineSeconds",
    "BIGINT NOT NULL DEFAULT 0"
  );

  totalTableReady = true;
};

const ensureTables = async () => {
  await ensureDailyActivityTable();
  await ensureTotalOnlineTable();
};

export const ensureFemaleOnlineTimeTables = ensureTables;

const getDailyRow = async (userId, activityDate) => {
  const rows = await sequelize.query(
    `SELECT loggedIn, onlineMinutes, onlineSeconds, lastHeartbeatAt, sessionStartedAt
FROM female_daily_activity
WHERE userId = :userId AND activityDate = :activityDate
LIMIT 1`,
    {
      replacements: { userId, activityDate },
      type: QueryTypes.SELECT,
    }
  );

  return rows[0] ?? null;
};

const getTotalRow = async (userId) => {
  const rows = await sequelize.query(
    `SELECT totalOnlineMinutes, totalOnlineSeconds, lastSessionStartedAt, lastHeartbeatAt
FROM female_creator_online_stats
WHERE userId = :userId
LIMIT 1`,
    {
      replacements: { userId },
      type: QueryTypes.SELECT,
    }
  );

  return rows[0] ?? null;
};

const getStoredTodaySeconds = (dailyRow) => {
  if (dailyRow?.onlineSeconds != null) {
    return Number(dailyRow.onlineSeconds);
  }

  return Number(dailyRow?.onlineMinutes ?? 0) * 60;
};

const getStoredTotalSeconds = (totalRow) => {
  if (totalRow?.totalOnlineSeconds != null) {
    return Number(totalRow.totalOnlineSeconds);
  }

  return Number(totalRow?.totalOnlineMinutes ?? 0) * 60;
};

const calculateDeltaSeconds = (lastHeartbeatAt, now = new Date()) => {
  if (!lastHeartbeatAt) {
    return 0;
  }

  const lastHeartbeat = new Date(lastHeartbeatAt);
  const deltaSeconds = Math.floor(
    (now.getTime() - lastHeartbeat.getTime()) / 1000
  );

  if (deltaSeconds <= 0) {
    return 0;
  }

  return Math.min(deltaSeconds, MAX_DELTA_SECONDS);
};

const getPendingSessionSeconds = (
  lastHeartbeatAt,
  sessionActive,
  now = new Date()
) => {
  if (!sessionActive || !lastHeartbeatAt) {
    return 0;
  }

  return calculateDeltaSeconds(lastHeartbeatAt, now);
};

const buildOnlineTimeStats = ({
  activityDate,
  dailyRow,
  totalRow,
  now = new Date(),
}) => {
  const sessionActive = Boolean(totalRow?.lastSessionStartedAt);
  const lastHeartbeatAt =
    totalRow?.lastHeartbeatAt ??
    dailyRow?.lastHeartbeatAt ??
    null;

  const todayOnlineSeconds = getStoredTodaySeconds(dailyRow);
  const totalOnlineSeconds = getStoredTotalSeconds(totalRow);
  const pendingSessionSeconds = getPendingSessionSeconds(
    lastHeartbeatAt,
    sessionActive,
    now
  );

  const liveTodaySeconds =
    todayOnlineSeconds + pendingSessionSeconds;
  const liveTotalSeconds =
    totalOnlineSeconds + pendingSessionSeconds;

  return {
    activityDate,
    loggedIn: Boolean(dailyRow?.loggedIn),
    todayOnlineSeconds,
    totalOnlineSeconds,
    liveTodaySeconds,
    liveTotalSeconds,
    todayOnlineMinutes: Math.floor(liveTodaySeconds / 60),
    totalOnlineMinutes: Math.floor(liveTotalSeconds / 60),
    pendingSessionSeconds,
    lastHeartbeatAt,
    sessionActive,
    pingIntervalSeconds: PING_INTERVAL_SECONDS,
  };
};

const upsertDailyActivity = async ({
  userId,
  activityDate,
  onlineSeconds,
  lastHeartbeatAt,
  sessionStartedAt,
}) => {
  const onlineMinutes = Math.floor(Number(onlineSeconds) / 60);

  await sequelize.query(
    `INSERT INTO female_daily_activity
(userId, activityDate, loggedIn, onlineMinutes, onlineSeconds, lastHeartbeatAt, sessionStartedAt)
VALUES (:userId, :activityDate, 1, :onlineMinutesInsert, :onlineSecondsInsert, :lastHeartbeatAtInsert, :sessionStartedAtInsert)
ON DUPLICATE KEY UPDATE
loggedIn = 1,
onlineMinutes = :onlineMinutesUpdate,
onlineSeconds = :onlineSecondsUpdate,
lastHeartbeatAt = :lastHeartbeatAtUpdate,
sessionStartedAt = COALESCE(sessionStartedAt, :sessionStartedAtUpdate),
updatedAt = NOW()`,
    {
      replacements: {
        userId,
        activityDate,
        onlineMinutesInsert: onlineMinutes,
        onlineSecondsInsert: onlineSeconds,
        lastHeartbeatAtInsert: lastHeartbeatAt,
        sessionStartedAtInsert: sessionStartedAt,
        onlineMinutesUpdate: onlineMinutes,
        onlineSecondsUpdate: onlineSeconds,
        lastHeartbeatAtUpdate: lastHeartbeatAt,
        sessionStartedAtUpdate: sessionStartedAt,
      },
      type: QueryTypes.INSERT,
    }
  );
};

const upsertTotalOnlineStats = async ({
  userId,
  totalOnlineSeconds,
  lastSessionStartedAt,
  lastHeartbeatAt,
}) => {
  const totalOnlineMinutes = Math.floor(
    Number(totalOnlineSeconds) / 60
  );

  await sequelize.query(
    `INSERT INTO female_creator_online_stats
(userId, totalOnlineMinutes, totalOnlineSeconds, lastSessionStartedAt, lastHeartbeatAt)
VALUES (:userId, :totalOnlineMinutesInsert, :totalOnlineSecondsInsert, :lastSessionStartedAtInsert, :lastHeartbeatAtInsert)
ON DUPLICATE KEY UPDATE
totalOnlineMinutes = :totalOnlineMinutesUpdate,
totalOnlineSeconds = :totalOnlineSecondsUpdate,
lastSessionStartedAt = :lastSessionStartedAtUpdate,
lastHeartbeatAt = :lastHeartbeatAtUpdate,
updatedAt = NOW()`,
    {
      replacements: {
        userId,
        totalOnlineMinutesInsert: totalOnlineMinutes,
        totalOnlineSecondsInsert: totalOnlineSeconds,
        lastSessionStartedAtInsert: lastSessionStartedAt,
        lastHeartbeatAtInsert: lastHeartbeatAt,
        totalOnlineMinutesUpdate: totalOnlineMinutes,
        totalOnlineSecondsUpdate: totalOnlineSeconds,
        lastSessionStartedAtUpdate: lastSessionStartedAt,
        lastHeartbeatAtUpdate: lastHeartbeatAt,
      },
      type: QueryTypes.INSERT,
    }
  );
};

const applyOnlineDelta = async (userId, deltaSeconds, now = new Date()) => {
  if (deltaSeconds <= 0) {
    return {
      todayOnlineSeconds: 0,
      totalOnlineSeconds: 0,
    };
  }

  await ensureTables();

  const activityDate = getTodayKey();
  const dailyRow = await getDailyRow(userId, activityDate);
  const totalRow = await getTotalRow(userId);

  const todayOnlineSeconds =
    getStoredTodaySeconds(dailyRow) + deltaSeconds;
  const totalOnlineSeconds =
    getStoredTotalSeconds(totalRow) + deltaSeconds;

  await upsertDailyActivity({
    userId,
    activityDate,
    onlineSeconds: todayOnlineSeconds,
    lastHeartbeatAt: now,
    sessionStartedAt:
      dailyRow?.sessionStartedAt ??
      totalRow?.lastSessionStartedAt ??
      now,
  });

  await upsertTotalOnlineStats({
    userId,
    totalOnlineSeconds,
    lastSessionStartedAt:
      totalRow?.lastSessionStartedAt ??
      dailyRow?.sessionStartedAt ??
      now,
    lastHeartbeatAt: now,
  });

  return {
    todayOnlineSeconds,
    totalOnlineSeconds,
  };
};

export const recordFemaleOnlineSessionStart = async (userId) => {
  await ensureTables();

  const now = new Date();
  const activityDate = getTodayKey();
  const dailyRow = await getDailyRow(userId, activityDate);
  const totalRow = await getTotalRow(userId);

  await upsertDailyActivity({
    userId,
    activityDate,
    onlineSeconds: getStoredTodaySeconds(dailyRow),
    lastHeartbeatAt: now,
    sessionStartedAt: now,
  });

  await upsertTotalOnlineStats({
    userId,
    totalOnlineSeconds: getStoredTotalSeconds(totalRow),
    lastSessionStartedAt: now,
    lastHeartbeatAt: now,
  });

  return getFemaleOnlineTimeStats(userId);
};

export const recordFemaleOnlineHeartbeat = async (userId) => {
  await ensureTables();

  const now = new Date();
  const activityDate = getTodayKey();
  const dailyRow = await getDailyRow(userId, activityDate);
  const totalRow = await getTotalRow(userId);

  const deltaSeconds = calculateDeltaSeconds(
    dailyRow?.lastHeartbeatAt ?? totalRow?.lastHeartbeatAt,
    now
  );

  if (deltaSeconds > 0) {
    await applyOnlineDelta(userId, deltaSeconds, now);
  } else if (!dailyRow) {
    await upsertDailyActivity({
      userId,
      activityDate,
      onlineSeconds: 0,
      lastHeartbeatAt: now,
      sessionStartedAt: totalRow?.lastSessionStartedAt ?? now,
    });

    if (!totalRow) {
      await upsertTotalOnlineStats({
        userId,
        totalOnlineSeconds: 0,
        lastSessionStartedAt: now,
        lastHeartbeatAt: now,
      });
    } else {
      await upsertTotalOnlineStats({
        userId,
        totalOnlineSeconds: getStoredTotalSeconds(totalRow),
        lastSessionStartedAt: totalRow.lastSessionStartedAt ?? now,
        lastHeartbeatAt: now,
      });
    }
  } else {
    await upsertDailyActivity({
      userId,
      activityDate,
      onlineSeconds: getStoredTodaySeconds(dailyRow),
      lastHeartbeatAt: now,
      sessionStartedAt: dailyRow.sessionStartedAt ?? now,
    });

    await upsertTotalOnlineStats({
      userId,
      totalOnlineSeconds: getStoredTotalSeconds(totalRow),
      lastSessionStartedAt:
        totalRow?.lastSessionStartedAt ??
        dailyRow.sessionStartedAt ??
        now,
      lastHeartbeatAt: now,
    });
  }

  return getFemaleOnlineTimeStats(userId);
};

export const recordFemaleOnlineSessionEnd = async (userId) => {
  await ensureTables();

  const now = new Date();
  const activityDate = getTodayKey();
  const dailyRow = await getDailyRow(userId, activityDate);
  const totalRow = await getTotalRow(userId);

  const deltaSeconds = calculateDeltaSeconds(
    dailyRow?.lastHeartbeatAt ?? totalRow?.lastHeartbeatAt,
    now
  );

  if (deltaSeconds > 0) {
    await applyOnlineDelta(userId, deltaSeconds, now);
  }

  const refreshedDaily = await getDailyRow(userId, activityDate);
  const refreshedTotal = await getTotalRow(userId);

  await upsertTotalOnlineStats({
    userId,
    totalOnlineSeconds: getStoredTotalSeconds(refreshedTotal),
    lastSessionStartedAt: null,
    lastHeartbeatAt: now,
  });

  const stats = buildOnlineTimeStats({
    activityDate,
    dailyRow: refreshedDaily,
    totalRow: {
      ...refreshedTotal,
      lastSessionStartedAt: null,
      lastHeartbeatAt: now,
    },
    now,
  });

  return {
    ...stats,
    sessionEndedAt: now,
  };
};

export const getFemaleOnlineTimeStats = async (userId) => {
  await ensureTables();

  const activityDate = getTodayKey();
  const dailyRow = await getDailyRow(userId, activityDate);
  const totalRow = await getTotalRow(userId);

  return buildOnlineTimeStats({
    activityDate,
    dailyRow,
    totalRow,
  });
};

export const recordFemaleDailyLogin = async (userId) => {
  await ensureTables();

  const activityDate = getTodayKey();

  await sequelize.query(
    `INSERT INTO female_daily_activity
(userId, activityDate, loggedIn, onlineMinutes)
VALUES (:userId, :activityDate, 1, 0)
ON DUPLICATE KEY UPDATE
loggedIn = 1,
updatedAt = NOW()`,
    {
      replacements: { userId, activityDate },
      type: QueryTypes.INSERT,
    }
  );
};
