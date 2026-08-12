import { Op, QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { UserOnlineLog } from "../models/UserOnlineLog.js";
import { User } from "../models/index.js";

let schemaReady = false;

const DEBOUNCE_MS = 5 * 60 * 1000;

const ensureUserOnlineLogTable = async () => {
  if (schemaReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_online_logs (
id BIGINT NOT NULL AUTO_INCREMENT,
userId BIGINT NOT NULL,
gender VARCHAR(20) NULL,
cameOnlineAt DATETIME NOT NULL,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (id),
INDEX idx_user_online_logs_came_online (cameOnlineAt),
INDEX idx_user_online_logs_user (userId)
)`
  );

  schemaReady = true;
};

const getDisplayName = (user) => {
  if (!user) {
    return "Unknown";
  }

  const data = user.toJSON ? user.toJSON() : user;

  return (
    data.nickname ||
    (data.name && data.name !== "New User" ? data.name : null) ||
    data.username ||
    data.publicUserId ||
    data.phone ||
    `User ${data.id ?? ""}`.trim()
  );
};

export const logUserCameOnline = async (user) => {
  if (!user?.id) {
    return null;
  }

  await ensureUserOnlineLogTable();

  const userId = Number(user.id);
  const now = new Date();

  const recent = await UserOnlineLog.findOne({
    where: { userId },
    order: [["cameOnlineAt", "DESC"]],
  });

  if (
    recent &&
    now.getTime() - new Date(recent.cameOnlineAt).getTime() < DEBOUNCE_MS
  ) {
    return recent;
  }

  await User.update(
    {
      lastSeen: now,
    },
    {
      where: { id: userId },
    }
  );

  return UserOnlineLog.create({
    userId,
    gender: user.gender || null,
    cameOnlineAt: now,
  });
};

export const listUserOnlineActivity = async ({
  page = 1,
  limit = 25,
  search = "",
  date = "",
  gender = "all",
}) => {
  await ensureUserOnlineLogTable();

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 25));
  const offset = (safePage - 1) * safeLimit;

  const andConditions = [];

  if (date) {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    andConditions.push({
      cameOnlineAt: {
        [Op.gte]: start,
        [Op.lt]: end,
      },
    });
  }

  const normalizedGender = String(gender || "all").trim().toLowerCase();

  if (normalizedGender === "male") {
    andConditions.push({
      gender: {
        [Op.in]: ["Male", "male"],
      },
    });
  } else if (normalizedGender === "female") {
    andConditions.push({
      gender: {
        [Op.in]: ["Female", "female"],
      },
    });
  }

  if (search) {
    const matchingUsers = await User.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.like]: `%${search}%` } },
          { nickname: { [Op.like]: `%${search}%` } },
          { username: { [Op.like]: `%${search}%` } },
          { publicUserId: { [Op.like]: `%${search}%` } },
          { phone: { [Op.like]: `%${search}%` } },
        ],
      },
      attributes: ["id"],
    });

    const userIds = matchingUsers.map((item) => item.id);

    if (userIds.length === 0) {
      return {
        summary: {
          totalEntries: 0,
          uniqueUsers: 0,
          onlineNow: 0,
        },
        rows: [],
        page: safePage,
        limit: safeLimit,
        total: 0,
        hasMore: false,
      };
    }

    andConditions.push({
      userId: {
        [Op.in]: userIds,
      },
    });
  }

  const where =
    andConditions.length === 0
      ? {}
      : andConditions.length === 1
        ? andConditions[0]
        : { [Op.and]: andConditions };

  const userInclude = {
    model: User,
    as: "user",
    required: true,
    attributes: [
      "id",
      "name",
      "nickname",
      "username",
      "phone",
      "publicUserId",
      "gender",
      "online",
      "lastSeen",
    ],
  };

  const [rows, total, summaryRow, onlineNow] = await Promise.all([
    UserOnlineLog.findAll({
      where,
      include: [userInclude],
      order: [["cameOnlineAt", "DESC"]],
      limit: safeLimit,
      offset,
    }),
    UserOnlineLog.count({ where }),
    UserOnlineLog.findOne({
      where,
      attributes: [
        [sequelize.fn("COUNT", sequelize.col("user_online_logs.id")), "totalEntries"],
        [
          sequelize.fn("COUNT", sequelize.fn("DISTINCT", sequelize.col("user_online_logs.userId"))),
          "uniqueUsers",
        ],
      ],
      raw: true,
    }),
    User.count({
      where: {
        online: true,
      },
    }),
  ]);

  const formattedRows = rows.map((entry) => {
    const row = entry.toJSON();
    const user = row.user || {};

    return {
      id: row.id,
      userId: row.userId,
      displayName: getDisplayName(user),
      phone: user.phone || "—",
      publicUserId: user.publicUserId || "—",
      gender: user.gender || row.gender || "—",
      currentlyOnline: Boolean(user.online),
      lastSeen: user.lastSeen || row.cameOnlineAt,
      cameOnlineAt: row.cameOnlineAt,
      loginDate: row.cameOnlineAt,
      loginTime: row.cameOnlineAt,
    };
  });

  return {
    summary: {
      totalEntries: Number(summaryRow?.totalEntries || 0),
      uniqueUsers: Number(summaryRow?.uniqueUsers || 0),
      onlineNow: Number(onlineNow || 0),
    },
    rows: formattedRows,
    page: safePage,
    limit: safeLimit,
    total,
    hasMore: offset + formattedRows.length < total,
  };
};

export const ensureUserOnlineLogSchema = ensureUserOnlineLogTable;
