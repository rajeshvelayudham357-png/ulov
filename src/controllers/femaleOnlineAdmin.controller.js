import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  forceAllFemalesOffline,
  forceFemaleOffline,
} from "../services/femaleOffline.service.js";

const getDisplayName = (row) =>
  row.nickname ||
  (row.name && row.name !== "New User" ? row.name : null) ||
  row.username ||
  row.phone ||
  `User ${row.id}`;

const getLastActivityAt = (row) =>
  row.lastHeartbeatAt || row.lastSeen || row.updatedAt || null;

const isStaleOnline = (row, staleHours = 1) => {
  if (!row.online) {
    return false;
  }

  const lastActivity = getLastActivityAt(row);
  if (!lastActivity) {
    return true;
  }

  const staleMs = Number(staleHours) * 60 * 60 * 1000;
  return Date.now() - new Date(lastActivity).getTime() >= staleMs;
};

export const listFemaleOnlineStatus = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const onlineFilter = String(req.query.online || "all").trim().toLowerCase();
    const staleHours = Math.max(1, Number(req.query.staleHours) || 1);

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
      const stale = isStaleOnline(row, staleHours);

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
      staleOnline: rows.filter((row) => isStaleOnline(row, staleHours)).length,
      staleHours,
    };

    return res.json({
      summary,
      rows: mapped,
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
    const staleHours = Math.max(1, Number(req.body?.hours) || 1);

    const rows = await sequelize.query(
      `SELECT
        u.id,
        u.online,
        u.lastSeen,
        u.updatedAt,
        s.lastHeartbeatAt
      FROM users u
      LEFT JOIN female_creator_online_stats s ON s.userId = u.id
      WHERE u.gender IN ('Female', 'female')
        AND u.online = 1
        AND COALESCE(s.lastHeartbeatAt, u.lastSeen, u.updatedAt)
            < DATE_SUB(NOW(), INTERVAL :hours HOUR)`,
      {
        replacements: { hours: staleHours },
        type: QueryTypes.SELECT,
      }
    );

    const results = [];

    for (const row of rows) {
      try {
        const result = await forceFemaleOffline(row.id);
        results.push(result);
      } catch (error) {
        results.push({
          userId: row.id,
          error: error.message,
        });
      }
    }

    return res.json({
      message: `Turned offline ${results.filter((item) => !item.error).length} stale female users (inactive ${staleHours}+ hour)`,
      staleHours,
      requested: rows.length,
      processed: results.filter((item) => !item.error).length,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const previewStaleFemaleCreators = async (req, res) => {
  try {
    const staleHours = Math.max(1, Number(req.query.hours) || 1);

    const countRow = await sequelize.query(
      `SELECT COUNT(*) AS total
      FROM users u
      LEFT JOIN female_creator_online_stats s ON s.userId = u.id
      WHERE u.gender IN ('Female', 'female')
        AND u.online = 1
        AND COALESCE(s.lastHeartbeatAt, u.lastSeen, u.updatedAt)
            < DATE_SUB(NOW(), INTERVAL :hours HOUR)`,
      {
        replacements: { hours: staleHours },
        type: QueryTypes.SELECT,
      }
    );

    return res.json({
      staleHours,
      count: Number(countRow[0]?.total) || 0,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
