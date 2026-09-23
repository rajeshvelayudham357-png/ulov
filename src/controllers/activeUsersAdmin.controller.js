import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  getSocketConnectedUserIdSet,
  getSocketConnectionCount,
} from "../services/socketPresence.service.js";

const getDisplayName = (row) =>
  row.nickname ||
  (row.name && row.name !== "New User" ? row.name : null) ||
  row.username ||
  row.phone ||
  `User ${row.id}`;

const normalizeGender = (value) => {
  const gender = String(value || "").trim().toLowerCase();
  if (gender === "female") {
    return "Female";
  }
  if (gender === "male") {
    return "Male";
  }
  return value || "—";
};

const buildSearchClause = (search) => {
  const term = String(search || "").trim();
  if (!term) {
    return { clause: "", replacements: {} };
  }

  const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
  const compact = term.replace(/[^a-zA-Z0-9]/g, "");
  const idValue = Number(term);

  const parts = [
    "u.name LIKE :like ESCAPE '\\\\'",
    "u.nickname LIKE :like ESCAPE '\\\\'",
    "u.username LIKE :like ESCAPE '\\\\'",
    "u.phone LIKE :like ESCAPE '\\\\'",
    "u.publicUserId LIKE :like ESCAPE '\\\\'",
  ];

  const replacements = { like };

  if (compact) {
    parts.push(
      "REPLACE(REPLACE(REPLACE(u.phone, '+', ''), ' ', ''), '-', '') LIKE :compactLike ESCAPE '\\\\'"
    );
    replacements.compactLike = `%${compact}%`;
  }

  if (Number.isFinite(idValue) && idValue > 0) {
    parts.push("u.id = :userId");
    replacements.userId = idValue;
  }

  return {
    clause: ` AND (${parts.join(" OR ")})`,
    replacements,
  };
};

export const listActiveUsersNow = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const genderFilter = String(req.query.gender || "all")
      .trim()
      .toLowerCase();
    const search = String(req.query.search || "").trim();

    const genderClause =
      genderFilter === "male"
        ? " AND u.gender IN ('Male', 'male')"
        : genderFilter === "female"
          ? " AND u.gender IN ('Female', 'female')"
          : "";

    const { clause: searchClause, replacements: searchReplacements } =
      buildSearchClause(search);

    const baseWhere = `u.online = 1${genderClause}${searchClause}`;

    const [summaryRows, totalRows, listRows] = await Promise.all([
      sequelize.query(
        `SELECT
          COUNT(*) AS totalOnline,
          SUM(CASE WHEN u.gender IN ('Male', 'male') THEN 1 ELSE 0 END) AS maleOnline,
          SUM(CASE WHEN u.gender IN ('Female', 'female') THEN 1 ELSE 0 END) AS femaleOnline
        FROM users u
        WHERE u.online = 1`,
        { type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*) AS total
        FROM users u
        WHERE ${baseWhere}`,
        {
          type: QueryTypes.SELECT,
          replacements: searchReplacements,
        }
      ),
      sequelize.query(
        `SELECT
          u.id,
          u.publicUserId,
          u.name,
          u.nickname,
          u.username,
          u.phone,
          u.avatar,
          u.gender,
          u.online,
          u.lastSeen,
          u.accountStatus,
          u.updatedAt,
          s.lastHeartbeatAt,
          s.lastSessionStartedAt,
          (
            SELECT MAX(dt.updatedAt)
            FROM device_tokens dt
            WHERE dt.userId = u.id
          ) AS lastAppOpenAt
        FROM users u
        LEFT JOIN female_creator_online_stats s ON s.userId = u.id
        WHERE ${baseWhere}
        ORDER BY COALESCE(s.lastHeartbeatAt, u.lastSeen, u.updatedAt) DESC
        LIMIT :limit OFFSET :offset`,
        {
          type: QueryTypes.SELECT,
          replacements: {
            ...searchReplacements,
            limit,
            offset,
          },
        }
      ),
    ]);

    const summaryRow = summaryRows[0] || {};
    const total = Number(totalRows[0]?.total || 0);
    const socketConnectedIds = getSocketConnectedUserIdSet();

    const rows = listRows.map((row) => {
      const lastActivityAt =
        row.lastHeartbeatAt ||
        row.lastAppOpenAt ||
        row.lastSeen ||
        row.updatedAt ||
        null;

      return {
        id: Number(row.id),
        publicUserId: row.publicUserId || "",
        displayName: getDisplayName(row),
        phone: row.phone || "—",
        avatar: row.avatar || null,
        gender: normalizeGender(row.gender),
        online: Boolean(row.online),
        accountStatus: row.accountStatus || null,
        lastSeen: row.lastSeen || null,
        lastHeartbeatAt: row.lastHeartbeatAt || null,
        lastSessionStartedAt: row.lastSessionStartedAt || null,
        lastAppOpenAt: row.lastAppOpenAt || null,
        lastActivityAt,
        socketConnected: socketConnectedIds.has(String(row.id)),
      };
    });

    const socketConnectedOnPage = rows.filter((row) => row.socketConnected).length;

    return res.json({
      summary: {
        totalOnline: Number(summaryRow.totalOnline) || 0,
        maleOnline: Number(summaryRow.maleOnline) || 0,
        femaleOnline: Number(summaryRow.femaleOnline) || 0,
        socketConnections: getSocketConnectionCount(),
        filteredTotal: total,
        socketConnectedOnPage,
      },
      rows,
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
