import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { forceFemaleOffline } from "./femaleOffline.service.js";

let schemaReady = false;

const DEFAULT_SETTINGS = {
  autoOffline30mEnabled: false,
  autoOffline1hEnabled: false,
};

const ensureSchema = async () => {
  if (schemaReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_female_online_scheduler (
      id TINYINT NOT NULL PRIMARY KEY,
      autoOffline30mEnabled TINYINT(1) NOT NULL DEFAULT 0,
      autoOffline1hEnabled TINYINT(1) NOT NULL DEFAULT 0,
      lastRun30mAt DATETIME NULL,
      lastRun1hAt DATETIME NULL,
      lastProcessed30m INT NOT NULL DEFAULT 0,
      lastProcessed1h INT NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_female_online_scheduler
     (id, autoOffline30mEnabled, autoOffline1hEnabled)
     VALUES (1, 0, 0)`
  );

  schemaReady = true;
};

const normalizeSettings = (row = {}) => ({
  autoOffline30mEnabled: Boolean(Number(row.autoOffline30mEnabled ?? 0)),
  autoOffline1hEnabled: Boolean(Number(row.autoOffline1hEnabled ?? 0)),
  lastRun30mAt: row.lastRun30mAt ?? null,
  lastRun1hAt: row.lastRun1hAt ?? null,
  lastProcessed30m: Number(row.lastProcessed30m ?? 0) || 0,
  lastProcessed1h: Number(row.lastProcessed1h ?? 0) || 0,
  updatedAt: row.updatedAt ?? null,
});

export const getFemaleOnlineSchedulerSettings = async () => {
  await ensureSchema();

  const rows = await sequelize.query(
    `SELECT *
     FROM admin_female_online_scheduler
     WHERE id = 1
     LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  return normalizeSettings(rows[0] ?? DEFAULT_SETTINGS);
};

export const updateFemaleOnlineSchedulerSettings = async ({
  autoOffline30mEnabled,
  autoOffline1hEnabled,
} = {}) => {
  await ensureSchema();

  const current = await getFemaleOnlineSchedulerSettings();

  const next = {
    autoOffline30mEnabled:
      autoOffline30mEnabled === undefined
        ? current.autoOffline30mEnabled
        : Boolean(autoOffline30mEnabled),
    autoOffline1hEnabled:
      autoOffline1hEnabled === undefined
        ? current.autoOffline1hEnabled
        : Boolean(autoOffline1hEnabled),
  };

  await sequelize.query(
    `UPDATE admin_female_online_scheduler
     SET autoOffline30mEnabled = :autoOffline30mEnabled,
         autoOffline1hEnabled = :autoOffline1hEnabled,
         updatedAt = NOW()
     WHERE id = 1`,
    {
      replacements: {
        autoOffline30mEnabled: next.autoOffline30mEnabled ? 1 : 0,
        autoOffline1hEnabled: next.autoOffline1hEnabled ? 1 : 0,
      },
    }
  );

  return getFemaleOnlineSchedulerSettings();
};

export const findStaleOnlineFemaleIds = async (inactiveMinutes) => {
  const minutes = Math.max(1, Number(inactiveMinutes) || 60);

  const rows = await sequelize.query(
    `SELECT u.id
     FROM users u
     LEFT JOIN female_creator_online_stats s ON s.userId = u.id
     WHERE u.gender IN ('Female', 'female')
       AND u.online = 1
       AND COALESCE(s.lastHeartbeatAt, u.lastSeen, u.updatedAt)
           < DATE_SUB(NOW(), INTERVAL :minutes MINUTE)`,
    {
      replacements: { minutes },
      type: QueryTypes.SELECT,
    }
  );

  return rows.map((row) => Number(row.id)).filter(Number.isFinite);
};

export const offlineStaleFemaleCreatorsByMinutes = async (
  inactiveMinutes,
  { source = "manual" } = {}
) => {
  const minutes = Math.max(1, Number(inactiveMinutes) || 60);
  const userIds = await findStaleOnlineFemaleIds(minutes);
  const results = [];

  for (const userId of userIds) {
    try {
      const result = await forceFemaleOffline(userId);
      results.push(result);
    } catch (error) {
      results.push({
        userId,
        error: error.message,
      });
    }
  }

  const processed = results.filter((item) => !item.error).length;

  if (source === "scheduler") {
    await ensureSchema();

    const columnPrefix = minutes >= 60 ? "1h" : "30m";

    await sequelize.query(
      `UPDATE admin_female_online_scheduler
       SET lastRun${columnPrefix}At = NOW(),
           lastProcessed${columnPrefix} = :processed,
           updatedAt = NOW()
       WHERE id = 1`,
      {
        replacements: { processed },
      }
    );
  }

  return {
    inactiveMinutes: minutes,
    source,
    requested: userIds.length,
    processed,
    results,
  };
};

let schedulerTimer = null;
let schedulerRunning = false;

export const processFemaleOnlineScheduler = async () => {
  if (schedulerRunning) {
    return { skipped: true, reason: "already_running" };
  }

  schedulerRunning = true;

  try {
    const settings = await getFemaleOnlineSchedulerSettings();
    const summary = {
      autoOffline30mEnabled: settings.autoOffline30mEnabled,
      autoOffline1hEnabled: settings.autoOffline1hEnabled,
      runs: [],
    };

    if (!settings.autoOffline30mEnabled && !settings.autoOffline1hEnabled) {
      return { ...summary, skipped: true, reason: "disabled" };
    }

    if (settings.autoOffline30mEnabled) {
      summary.runs.push(
        await offlineStaleFemaleCreatorsByMinutes(30, {
          source: "scheduler",
        })
      );
    }

    if (settings.autoOffline1hEnabled) {
      summary.runs.push(
        await offlineStaleFemaleCreatorsByMinutes(60, {
          source: "scheduler",
        })
      );
    }

    const totalProcessed = summary.runs.reduce(
      (sum, run) => sum + Number(run.processed || 0),
      0
    );

    if (totalProcessed > 0) {
      console.log(
        "[FEMALE_ONLINE_SCHEDULER]",
        `Processed ${totalProcessed} stale female creator(s)`
      );
    }

    return summary;
  } finally {
    schedulerRunning = false;
  }
};

export const startFemaleOnlineScheduler = () => {
  if (schedulerTimer) {
    return;
  }

  const intervalMs = Number(
    process.env.FEMALE_ONLINE_SCHEDULER_MS ?? 5 * 60 * 1000
  );

  schedulerTimer = setInterval(() => {
    processFemaleOnlineScheduler().catch((error) => {
      console.log("[FEMALE_ONLINE_SCHEDULER_ERROR]", error.message);
    });
  }, intervalMs);

  if (typeof schedulerTimer.unref === "function") {
    schedulerTimer.unref();
  }

  processFemaleOnlineScheduler().catch((error) => {
    console.log("[FEMALE_ONLINE_SCHEDULER_BOOT_ERROR]", error.message);
  });

  console.log(
    `Female online scheduler started (every ${Math.round(intervalMs / 1000)}s)`
  );
};

export const stopFemaleOnlineScheduler = () => {
  if (!schedulerTimer) {
    return;
  }

  clearInterval(schedulerTimer);
  schedulerTimer = null;
};
