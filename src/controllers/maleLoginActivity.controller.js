import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { ensureUserOnlineLogSchema } from "../services/userOnlineLog.service.js";
import { ensureUserSchema } from "../services/userSchema.service.js";

const getDisplayName = (row) =>
  row.nickname ||
  (row.name && row.name !== "New User" ? row.name : null) ||
  row.username ||
  row.phone ||
  `User ${row.id}`;

const pickLatestTimestamp = (...values) => {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return timestamps[0] || null;
};

export const listMaleLoginActivity = async (req, res) => {
  try {
    await Promise.all([ensureUserSchema(), ensureUserOnlineLogSchema()]);

    const search = String(req.query.search || "").trim();
    const inactiveDays = Math.max(0, Number(req.query.inactiveDays) || 0);

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
        u.lastLoginAt,
        u.createdAt,
        u.updatedAt,
        (
          SELECT MAX(dt.updatedAt)
          FROM device_tokens dt
          WHERE dt.userId = u.id
        ) AS lastAppOpenAt,
        (
          SELECT MAX(log.cameOnlineAt)
          FROM user_online_logs log
          WHERE log.userId = u.id
        ) AS lastOnlineLogAt
      FROM users u
      WHERE u.gender IN ('Male', 'male')
      ORDER BY COALESCE(u.lastLoginAt, u.lastSeen, u.updatedAt) DESC
      LIMIT 2000`,
      { type: QueryTypes.SELECT }
    );

    let mapped = rows.map((row) => {
      const lastLoginAt = row.lastLoginAt || null;
      const lastAppOpenAt = row.lastAppOpenAt || null;
      const lastOnlineLogAt = row.lastOnlineLogAt || null;
      const lastSeen = row.lastSeen || null;
      const lastActivityAt = pickLatestTimestamp(
        lastLoginAt,
        lastAppOpenAt,
        lastOnlineLogAt,
        lastSeen,
        row.updatedAt
      );

      return {
        id: Number(row.id),
        publicUserId: row.publicUserId || "",
        displayName: getDisplayName(row),
        phone: row.phone || "—",
        avatar: row.avatar || null,
        online: Boolean(row.online),
        lastLoginAt,
        lastAppOpenAt,
        lastOnlineLogAt,
        lastSeen,
        lastActivityAt,
        registeredAt: row.createdAt,
        hasLoginRecord: Boolean(lastLoginAt),
        hasAppOpenRecord: Boolean(lastAppOpenAt),
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

    if (inactiveDays > 0) {
      const cutoff = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;

      mapped = mapped.filter((row) => {
        if (!row.lastActivityAt) {
          return true;
        }

        return new Date(row.lastActivityAt).getTime() < cutoff;
      });
    }

    const summary = {
      totalMales: mapped.length,
      loggedInTracked: mapped.filter((row) => row.hasLoginRecord).length,
      appOpenTracked: mapped.filter((row) => row.hasAppOpenRecord).length,
      onlineNow: mapped.filter((row) => row.online).length,
      inactive7Days: mapped.filter((row) => {
        if (!row.lastActivityAt) {
          return true;
        }

        return (
          Date.now() - new Date(row.lastActivityAt).getTime() >=
          7 * 24 * 60 * 60 * 1000
        );
      }).length,
    };

    return res.json({
      summary,
      rows: mapped,
      notes: {
        lastLoginAt:
          "Recorded on OTP/PIN login after backend update. Older logins may be empty.",
        lastAppOpenAt:
          "Captured when the app opens with an active session and registers push token. No mobile change needed.",
        lastActivityAt:
          "Best available timestamp from login, app open, online log, or last seen.",
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
