import { QueryTypes } from "sequelize";

import { DEFAULT_BATTLE_SETTINGS } from "../constants/battle.js";
import {
  BattleAudienceSession,
  BattleFighter,
  BattleGiftRecord,
  BattleInvite,
  BattleRoom,
} from "../models/index.js";
import { sequelize } from "../config/database.js";

let settingsTableReady = false;
let battleSchemaReady = false;

const safeModelSync = async (model, label) => {
  try {
    await model.sync({ alter: true });
    console.log(`${label} synced`);
  } catch (error) {
    console.log(`${label} alter sync skipped: ${error.message}`);
    await model.sync();
    console.log(`${label} base sync completed`);
  }
};

const indexExists = async (tableName, indexName) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS indexCount
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND INDEX_NAME = :indexName`,
    {
      replacements: { tableName, indexName },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.indexCount ?? 0) > 0;
};

const ensureBattleIndexes = async () => {
  const indexes = [
    {
      tableName: "battle_rooms",
      indexName: "uniq_battle_room_invite",
      statement:
        "CREATE UNIQUE INDEX uniq_battle_room_invite ON battle_rooms (inviteId)",
    },
    {
      tableName: "battle_fighters",
      indexName: "uniq_battle_fighter_slot",
      statement:
        "CREATE UNIQUE INDEX uniq_battle_fighter_slot ON battle_fighters (battleId, slot)",
    },
    {
      tableName: "battle_fighters",
      indexName: "uniq_battle_fighter_user",
      statement:
        "CREATE UNIQUE INDEX uniq_battle_fighter_user ON battle_fighters (battleId, userId)",
    },
    {
      tableName: "battle_fighters",
      indexName: "uniq_battle_active_fighter_guard",
      statement:
        "CREATE UNIQUE INDEX uniq_battle_active_fighter_guard ON battle_fighters (activeFighterGuard)",
    },
    {
      tableName: "battle_gift_records",
      indexName: "uniq_battle_gift_client_request",
      statement:
        "CREATE UNIQUE INDEX uniq_battle_gift_client_request ON battle_gift_records (clientRequestId)",
    },
  ];

  for (const index of indexes) {
    try {
      const exists = await indexExists(index.tableName, index.indexName);

      if (!exists) {
        await sequelize.query(index.statement);
      }
    } catch (error) {
      if (!String(error.message || "").includes("Duplicate")) {
        console.log("Battle index ensure skipped:", error.message);
      }
    }
  }
};

const ensureAdminBattleSettingsTable = async () => {
  if (settingsTableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_battle_settings (
      id TINYINT NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      defaultDurationSeconds INT NOT NULL DEFAULT 300,
      inviteTimeoutSeconds INT NOT NULL DEFAULT 120,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_battle_settings
      (id, enabled, defaultDurationSeconds, inviteTimeoutSeconds)
     VALUES
      (:id, :enabled, :defaultDurationSeconds, :inviteTimeoutSeconds)`,
    {
      replacements: {
        id: 1,
        enabled: DEFAULT_BATTLE_SETTINGS.enabled ? 1 : 0,
        defaultDurationSeconds: DEFAULT_BATTLE_SETTINGS.defaultDurationSeconds,
        inviteTimeoutSeconds: DEFAULT_BATTLE_SETTINGS.inviteTimeoutSeconds,
      },
    }
  );

  settingsTableReady = true;
};

export const getBattleSettings = async () => {
  await ensureAdminBattleSettingsTable();

  const rows = await sequelize.query(
    `SELECT enabled, defaultDurationSeconds, inviteTimeoutSeconds
     FROM admin_battle_settings
     WHERE id = 1
     LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  const row = rows[0] ?? {};

  return {
    enabled: Boolean(Number(row.enabled ?? DEFAULT_BATTLE_SETTINGS.enabled)),
    defaultDurationSeconds:
      Number(row.defaultDurationSeconds) ||
      DEFAULT_BATTLE_SETTINGS.defaultDurationSeconds,
    inviteTimeoutSeconds:
      Number(row.inviteTimeoutSeconds) ||
      DEFAULT_BATTLE_SETTINGS.inviteTimeoutSeconds,
  };
};

export const isBattleFeatureEnabled = async () => {
  const settings = await getBattleSettings();
  return Boolean(settings.enabled);
};

const clampDuration = (value, fallback) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 60) {
    return fallback;
  }

  return Math.min(1800, Math.max(60, Math.floor(parsed)));
};

const clampInviteTimeout = (value, fallback) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 30) {
    return fallback;
  }

  return Math.min(600, Math.max(30, Math.floor(parsed)));
};

export const updateBattleSettings = async (payload = {}) => {
  await ensureAdminBattleSettingsTable();

  const current = await getBattleSettings();

  const nextEnabled =
    payload.enabled !== undefined
      ? Boolean(payload.enabled)
      : current.enabled;

  const nextDuration =
    payload.defaultDurationSeconds !== undefined
      ? clampDuration(payload.defaultDurationSeconds, current.defaultDurationSeconds)
      : current.defaultDurationSeconds;

  const nextInviteTimeout =
    payload.inviteTimeoutSeconds !== undefined
      ? clampInviteTimeout(payload.inviteTimeoutSeconds, current.inviteTimeoutSeconds)
      : current.inviteTimeoutSeconds;

  await sequelize.query(
    `UPDATE admin_battle_settings
     SET enabled = :enabled,
         defaultDurationSeconds = :defaultDurationSeconds,
         inviteTimeoutSeconds = :inviteTimeoutSeconds
     WHERE id = 1`,
    {
      replacements: {
        enabled: nextEnabled ? 1 : 0,
        defaultDurationSeconds: nextDuration,
        inviteTimeoutSeconds: nextInviteTimeout,
      },
    }
  );

  return getBattleSettings();
};

export const ensureBattleSchema = async () => {
  if (battleSchemaReady) {
    return;
  }

  await ensureAdminBattleSettingsTable();

  await safeModelSync(BattleInvite, "BattleInvite");
  await safeModelSync(BattleRoom, "BattleRoom");
  await safeModelSync(BattleFighter, "BattleFighter");
  await safeModelSync(BattleAudienceSession, "BattleAudienceSession");
  await safeModelSync(BattleGiftRecord, "BattleGiftRecord");

  await ensureBattleIndexes();

  try {
    await sequelize.query(
      `UPDATE battle_fighters f
       LEFT JOIN battle_rooms r ON r.id = f.battleId
       SET f.status = 'left',
           f.leftAt = COALESCE(f.leftAt, NOW()),
           f.activeFighterGuard = CONCAT('left:', f.id)
       WHERE f.activeFighterGuard LIKE 'fighter:%'
         AND (r.id IS NULL OR r.status NOT IN ('accepted', 'live'))`
    );
  } catch (error) {
    console.log("battle stale fighter lock repair skipped:", error.message);
  }

  battleSchemaReady = true;
};

export const resetBattleSchemaCacheForTests = () => {
  settingsTableReady = false;
  battleSchemaReady = false;
};
