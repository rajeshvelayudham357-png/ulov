import { QueryTypes } from "sequelize";

import { DEFAULT_VOICE_ROOM_SETTINGS } from "../constants/voiceRoom.js";
import {
  VoiceRoom,
  VoiceRoomBillingTick,
  VoiceRoomEarning,
  VoiceRoomGiftRecord,
  VoiceRoomMemberSession,
  VoiceRoomMessage,
  VoiceRoomSeat,
  VoiceRoomSession,
} from "../models/index.js";
import { sequelize } from "../config/database.js";

let settingsTableReady = false;
let voiceRoomSchemaReady = false;

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

const ensureAdminVoiceRoomSettingsTable = async () => {
  if (settingsTableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_voice_room_settings (
      id TINYINT NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      ratePerMinute INT NOT NULL DEFAULT 5,
      hostEarningPercentage FLOAT NOT NULL DEFAULT 50,
      billingIntervalSeconds INT NOT NULL DEFAULT 60,
      reconnectGraceSeconds INT NOT NULL DEFAULT 30,
      maxSeats TINYINT NOT NULL DEFAULT 8,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  await sequelize.query(
    `INSERT IGNORE INTO admin_voice_room_settings
      (id, enabled, ratePerMinute, hostEarningPercentage, billingIntervalSeconds, reconnectGraceSeconds, maxSeats)
     VALUES
      (:id, :enabled, :ratePerMinute, :hostEarningPercentage, :billingIntervalSeconds, :reconnectGraceSeconds, :maxSeats)`,
    {
      replacements: {
        id: 1,
        enabled: DEFAULT_VOICE_ROOM_SETTINGS.enabled ? 1 : 0,
        ratePerMinute: DEFAULT_VOICE_ROOM_SETTINGS.ratePerMinute,
        hostEarningPercentage: DEFAULT_VOICE_ROOM_SETTINGS.hostEarningPercentage,
        billingIntervalSeconds: DEFAULT_VOICE_ROOM_SETTINGS.billingIntervalSeconds,
        reconnectGraceSeconds: DEFAULT_VOICE_ROOM_SETTINGS.reconnectGraceSeconds,
        maxSeats: DEFAULT_VOICE_ROOM_SETTINGS.maxSeats,
      },
    }
  );

  settingsTableReady = true;
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

const dropLegacyVoiceRoomIndexes = async () => {
  const legacyIndexes = [
    {
      tableName: "voice_room_member_sessions",
      indexName: "uniq_voice_room_session_user_active_status",
    },
  ];

  for (const index of legacyIndexes) {
    try {
      const exists = await indexExists(index.tableName, index.indexName);

      if (exists) {
        await sequelize.query(
          `DROP INDEX ${index.indexName} ON ${index.tableName}`
        );
        console.log(`Dropped legacy voice room index ${index.indexName}`);
      }
    } catch (error) {
      console.log(
        `Legacy voice room index drop skipped (${index.indexName}):`,
        error.message
      );
    }
  }
};

const ensureVoiceRoomIndexes = async () => {
  const indexes = [
    {
      tableName: "voice_room_seats",
      indexName: "uniq_voice_room_seat_index",
      statement:
        "CREATE UNIQUE INDEX uniq_voice_room_seat_index ON voice_room_seats (roomId, seatIndex)",
    },
    {
      tableName: "voice_room_billing_ticks",
      indexName: "uniq_voice_room_member_billing_minute",
      statement:
        "CREATE UNIQUE INDEX uniq_voice_room_member_billing_minute ON voice_room_billing_ticks (memberSessionId, billingMinute)",
    },
    {
      tableName: "voice_room_earnings",
      indexName: "uniq_voice_room_earning_session",
      statement:
        "CREATE UNIQUE INDEX uniq_voice_room_earning_session ON voice_room_earnings (sessionId)",
    },
    {
      tableName: "voice_room_member_sessions",
      indexName: "uniq_voice_room_active_membership_guard",
      statement:
        "CREATE UNIQUE INDEX uniq_voice_room_active_membership_guard ON voice_room_member_sessions (activeMembershipGuard)",
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
        console.log("Voice room index ensure skipped:", error.message);
      }
    }
  }
};

export const getVoiceRoomSettings = async () => {
  await ensureAdminVoiceRoomSettingsTable();

  const rows = await sequelize.query(
    `SELECT enabled, ratePerMinute, hostEarningPercentage, billingIntervalSeconds, reconnectGraceSeconds, maxSeats
     FROM admin_voice_room_settings
     WHERE id = 1
     LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  const row = rows[0] ?? {};

  return {
    enabled: Boolean(Number(row.enabled ?? DEFAULT_VOICE_ROOM_SETTINGS.enabled)),
    ratePerMinute:
      Number(row.ratePerMinute) || DEFAULT_VOICE_ROOM_SETTINGS.ratePerMinute,
    hostEarningPercentage:
      Number(row.hostEarningPercentage) ||
      DEFAULT_VOICE_ROOM_SETTINGS.hostEarningPercentage,
    billingIntervalSeconds:
      Number(row.billingIntervalSeconds) ||
      DEFAULT_VOICE_ROOM_SETTINGS.billingIntervalSeconds,
    reconnectGraceSeconds:
      Number(row.reconnectGraceSeconds) ||
      DEFAULT_VOICE_ROOM_SETTINGS.reconnectGraceSeconds,
    maxSeats: Number(row.maxSeats) || DEFAULT_VOICE_ROOM_SETTINGS.maxSeats,
  };
};

export const isVoiceRoomFeatureEnabled = async () => {
  const settings = await getVoiceRoomSettings();
  return Boolean(settings.enabled);
};

const clampAdminMaxSeats = (value, fallback) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 2) {
    return fallback;
  }

  return Math.min(8, Math.max(2, Math.floor(parsed)));
};

export const updateVoiceRoomSettings = async (payload = {}) => {
  await ensureAdminVoiceRoomSettingsTable();

  const current = await getVoiceRoomSettings();

  const nextEnabled =
    payload.enabled !== undefined
      ? Boolean(payload.enabled)
      : current.enabled;

  const nextMaxSeats =
    payload.maxSeats !== undefined
      ? clampAdminMaxSeats(payload.maxSeats, current.maxSeats)
      : current.maxSeats;

  await sequelize.query(
    `UPDATE admin_voice_room_settings
     SET enabled = :enabled,
         maxSeats = :maxSeats
     WHERE id = 1`,
    {
      replacements: {
        enabled: nextEnabled ? 1 : 0,
        maxSeats: nextMaxSeats,
      },
    }
  );

  return getVoiceRoomSettings();
};

export const ensureVoiceRoomSchema = async () => {
  if (voiceRoomSchemaReady) {
    return;
  }

  await ensureAdminVoiceRoomSettingsTable();

  await safeModelSync(VoiceRoom, "VoiceRoom");
  await safeModelSync(VoiceRoomSession, "VoiceRoomSession");
  await safeModelSync(VoiceRoomSeat, "VoiceRoomSeat");
  await safeModelSync(VoiceRoomMemberSession, "VoiceRoomMemberSession");
  await safeModelSync(VoiceRoomBillingTick, "VoiceRoomBillingTick");
  await safeModelSync(VoiceRoomEarning, "VoiceRoomEarning");
  await safeModelSync(VoiceRoomMessage, "VoiceRoomMessage");
  await safeModelSync(VoiceRoomGiftRecord, "VoiceRoomGiftRecord");

  await dropLegacyVoiceRoomIndexes();
  await ensureVoiceRoomIndexes();

  try {
    await sequelize.query(
      `UPDATE voice_room_member_sessions
       SET status = 'left',
           leftAt = COALESCE(leftAt, NOW()),
           activeMembershipGuard = CONCAT('left:', id)
       WHERE activeMembershipGuard LIKE 'user:%'
         AND (
           status NOT IN ('joining', 'connected', 'billing')
           OR sessionId NOT IN (
             SELECT id FROM voice_room_sessions WHERE status = 'live'
           )
         )`
    );
  } catch (error) {
    console.log(
      "voice room stale membership repair skipped:",
      error.message
    );
  }

  try {
    await sequelize.query(
      "ALTER TABLE voice_room_member_sessions ADD COLUMN activeMembershipGuard VARCHAR(96) NULL"
    );
  } catch (error) {
    if (!String(error.message || "").includes("Duplicate column")) {
      console.log("voice_room_member_sessions.activeMembershipGuard skipped:", error.message);
    }
  }

  try {
    await sequelize.query(
      "ALTER TABLE voice_rooms ADD COLUMN coverImageKey VARCHAR(32) NOT NULL DEFAULT 'voiceroom1'"
    );
  } catch (error) {
    if (!String(error.message || "").includes("Duplicate column")) {
      console.log("voice_rooms.coverImageKey skipped:", error.message);
    }
  }

  voiceRoomSchemaReady = true;
};

export const resetVoiceRoomSchemaCacheForTests = () => {
  settingsTableReady = false;
  voiceRoomSchemaReady = false;
};
