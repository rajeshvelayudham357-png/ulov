import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  forceAllFemalesOffline,
  forceFemaleOffline,
} from "../services/femaleOffline.service.js";
import {
  findStaleOnlineFemaleIds,
  getFemaleOnlineSchedulerSettings,
  offlineStaleFemaleCreatorsByMinutes,
  updateFemaleOnlineSchedulerSettings,
} from "../services/femaleOnlineScheduler.service.js";

const getDisplayName = (row) =>
  row.nickname ||
  (row.name && row.name !== "New User" ? row.name : null) ||
  row.username ||
  row.phone ||
  `User ${row.id}`;

const getLastActivityAt = (row) =>
  row.lastHeartbeatAt || row.lastSeen || row.updatedAt || null;

const parseInactiveMinutes = (source = {}, fallbackMinutes = 60) => {
  const minutes = Number(source?.minutes);
  if (Number.isFinite(minutes) && minutes > 0) {
    return Math.floor(minutes);
  }

  const hours = Number(source?.hours);
  if (Number.isFinite(hours) && hours > 0) {
    return Math.floor(hours * 60);
  }

  const staleHours = Number(source?.staleHours);
  if (Number.isFinite(staleHours) && staleHours > 0) {
    return Math.floor(staleHours * 60);
  }

  return fallbackMinutes;
};

const formatInactiveLabel = (inactiveMinutes) => {
  if (inactiveMinutes % 60 === 0 && inactiveMinutes >= 60) {
    const hours = inactiveMinutes / 60;
    return `${hours}+ hour${hours === 1 ? "" : "s"}`;
  }

  return `${inactiveMinutes}+ minute${inactiveMinutes === 1 ? "" : "s"}`;
};

const isStaleOnline = (row, inactiveMinutes = 60) => {
  if (!row.online) {
    return false;
  }

  const lastActivity = getLastActivityAt(row);
  if (!lastActivity) {
    return true;
  }

  const staleMs = Number(inactiveMinutes) * 60 * 1000;
  return Date.now() - new Date(lastActivity).getTime() >= staleMs;
};

export const listFemaleOnlineStatus = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const onlineFilter = String(req.query.online || "all").trim().toLowerCase();
    const staleMinutes = parseInactiveMinutes(req.query, 60);

    const rows = await sequelize.query(
      `SELECT
        u.id,
        u.publicUserId,
        u.name,
        u.nickname,
        u.username,
        u.phone,
        u.avatar,
        u.online,
        u.lastSeen,
        u.accountStatus,
        u.updatedAt,
        s.lastHeartbeatAt,
        s.lastSessionStartedAt
      FROM users u
      LEFT JOIN female_creator_online_stats s ON s.userId = u.id
      WHERE u.gender IN ('Female', 'female')
      ORDER BY u.online DESC, COALESCE(s.lastHeartbeatAt, u.lastSeen, u.updatedAt) DESC
      LIMIT 1000`,
      { type: QueryTypes.SELECT }
    );

    let mapped = rows.map((row) => {
      const lastActivityAt = getLastActivityAt(row);
      const stale = isStaleOnline(row, staleMinutes);

      return {
        id: Number(row.id),
        publicUserId: row.publicUserId || "",
        displayName: getDisplayName(row),
        phone: row.phone || "—",
        avatar: row.avatar || null,
        online: Boolean(row.online),
        accountStatus: row.accountStatus || "—",
        lastSeen: row.lastSeen,
        lastHeartbeatAt: row.lastHeartbeatAt,
        lastSessionStartedAt: row.lastSessionStartedAt,
        lastActivityAt,
        sessionActive: Boolean(row.lastSessionStartedAt),
        isStale: stale,
      };
    });

    if (search) {
      const query = search.toLowerCase();
      const compact = query.replace(/[^a-z0-9]/g, "");

      mapped = mapped.filter((row) => {
        const values = [
          row.displayName,
          row.phone,
          row.publicUserId,
          String(row.id),
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());

        return values.some((value) => {
          const compactValue = value.replace(/[^a-z0-9]/g, "");
          return (
            value.includes(query) ||
            (compact && compactValue.includes(compact))
          );
        });
      });
    }

    if (onlineFilter === "online") {
      mapped = mapped.filter((row) => row.online);
    } else if (onlineFilter === "offline") {
      mapped = mapped.filter((row) => !row.online);
    } else if (onlineFilter === "stale") {
      mapped = mapped.filter((row) => row.isStale);
    }

    const summary = {
      totalFemales: rows.length,
      onlineNow: rows.filter((row) => Boolean(row.online)).length,
      staleOnline: rows.filter((row) => isStaleOnline(row, staleMinutes)).length,
      staleOnline30m: rows.filter((row) => isStaleOnline(row, 30)).length,
      staleOnline1h: rows.filter((row) => isStaleOnline(row, 60)).length,
      staleMinutes,
      staleHours: staleMinutes / 60,
    };

    return res.json({
      summary,
      rows: mapped,
      scheduler: await getFemaleOnlineSchedulerSettings(),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const offlineFemaleCreator = async (req, res) => {
  try {
    const result = await forceFemaleOffline(req.params.id);

    return res.json({
      message: `${result.displayName} is now offline`,
      result,
    });
  } catch (error) {
    const status = error.message === "User not found" ? 404 : 400;
    return res.status(status).json({
      message: error.message,
    });
  }
};

export const offlineAllFemaleCreators = async (req, res) => {
  try {
    const result = await forceAllFemalesOffline();

    return res.json({
      message: `Turned offline ${result.processed} of ${result.requested} online female users`,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const offlineStaleFemaleCreators = async (req, res) => {
  try {
    const inactiveMinutes = parseInactiveMinutes(req.body, 60);
    const result = await offlineStaleFemaleCreatorsByMinutes(inactiveMinutes, {
      source: "manual",
    });

    return res.json({
      message: `Turned offline ${result.processed} stale female users (inactive ${formatInactiveLabel(inactiveMinutes)})`,
      inactiveMinutes,
      staleMinutes: inactiveMinutes,
      staleHours: inactiveMinutes / 60,
      requested: result.requested,
      processed: result.processed,
      results: result.results,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const previewStaleFemaleCreators = async (req, res) => {
  try {
    const inactiveMinutes = parseInactiveMinutes(req.query, 60);
    const userIds = await findStaleOnlineFemaleIds(inactiveMinutes);

    return res.json({
      inactiveMinutes,
      staleMinutes: inactiveMinutes,
      staleHours: inactiveMinutes / 60,
      count: userIds.length,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getFemaleOnlineScheduler = async (_req, res) => {
  try {
    const settings = await getFemaleOnlineSchedulerSettings();

    return res.json({
      ...settings,
      intervalMinutes: Math.max(
        1,
        Math.round(
          Number(process.env.FEMALE_ONLINE_SCHEDULER_MS ?? 5 * 60 * 1000) /
            60000
        )
      ),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateFemaleOnlineScheduler = async (req, res) => {
  try {
    const settings = await updateFemaleOnlineSchedulerSettings({
      autoOffline30mEnabled: req.body?.autoOffline30mEnabled,
      autoOffline1hEnabled: req.body?.autoOffline1hEnabled,
    });

    return res.json({
      message: "Female online scheduler updated",
      ...settings,
      intervalMinutes: Math.max(
        1,
        Math.round(
          Number(process.env.FEMALE_ONLINE_SCHEDULER_MS ?? 5 * 60 * 1000) /
            60000
        )
      ),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
