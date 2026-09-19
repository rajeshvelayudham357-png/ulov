import { Op, QueryTypes } from "sequelize";

import { User } from "../models/index.js";
import { sequelize } from "../config/database.js";
import { ensureColumn } from "./schemaUtil.service.js";

const MAX_EXCLUDE_USERS = 50;
let columnReady = false;
let columnReadyPromise = null;

export const parseRevenueExcludeUserIds = (value) => {
  let ids = value;

  if (typeof ids === "string" && ids.trim()) {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = ids.split(/[,\s]+/);
    }
  }

  if (!Array.isArray(ids)) {
    if (ids && typeof ids === "object") {
      ids = Object.values(ids);
    } else if (ids != null && ids !== "") {
      ids = [ids];
    } else {
      ids = [];
    }
  }

  const unique = [];

  for (const item of ids) {
    const id = Number(item?.id ?? item);

    if (!Number.isFinite(id) || id <= 0 || unique.includes(id)) {
      continue;
    }

    unique.push(id);

    if (unique.length >= MAX_EXCLUDE_USERS) {
      break;
    }
  }

  return unique;
};

const ensureRevenueExcludeUsersColumn = async () => {
  if (columnReady) {
    return;
  }

  if (!columnReadyPromise) {
    columnReadyPromise = ensureColumn(
      "admin_app_settings",
      "revenueExcludeUserIds",
      "JSON NULL"
    )
      .then(() => {
        columnReady = true;
      })
      .finally(() => {
        columnReadyPromise = null;
      });
  }

  await columnReadyPromise;
};

export const serializeRevenueUser = (user) => {
  const data = user?.toJSON ? user.toJSON() : user || {};

  return {
    id: Number(data.id),
    publicUserId: data.publicUserId || null,
    displayName:
      data.nickname ||
      data.username ||
      (data.name && data.name !== "New User" ? data.name : null) ||
      data.phone ||
      `User ${data.id}`,
    phone: data.phone || "",
    gender: data.gender || "",
  };
};

export const getRevenueExcludeUserIds = async () => {
  await ensureRevenueExcludeUsersColumn();

  const [row] = await sequelize.query(
    `SELECT revenueExcludeUserIds
     FROM admin_app_settings
     WHERE id = 1
     LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  return parseRevenueExcludeUserIds(row?.revenueExcludeUserIds);
};

export const loadRevenueUsersByIds = async (userIds = []) => {
  const ids = parseRevenueExcludeUserIds(userIds);

  if (ids.length === 0) {
    return [];
  }

  const users = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: [
      "id",
      "publicUserId",
      "username",
      "name",
      "nickname",
      "phone",
      "gender",
    ],
  });

  const byId = new Map(users.map((user) => [Number(user.id), user]));

  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(serializeRevenueUser);
};

export const getRevenueExcludeUsers = async () => {
  const userIds = await getRevenueExcludeUserIds();
  const users = await loadRevenueUsersByIds(userIds);

  return { userIds, users };
};

export const setRevenueExcludeUserIds = async (userIds = []) => {
  await ensureRevenueExcludeUsersColumn();

  const nextIds = parseRevenueExcludeUserIds(userIds);

  await sequelize.query(
    `UPDATE admin_app_settings
     SET revenueExcludeUserIds = :userIds
     WHERE id = 1`,
    {
      replacements: { userIds: JSON.stringify(nextIds) },
    }
  );

  return getRevenueExcludeUsers();
};

export const searchRevenueExcludeCandidates = async (search = "") => {
  const query = String(search || "").trim();
  const where = {};

  if (query) {
    const like = `%${query}%`;
    const conditions = [
      { name: { [Op.like]: like } },
      { nickname: { [Op.like]: like } },
      { username: { [Op.like]: like } },
      { publicUserId: { [Op.like]: like } },
      { phone: { [Op.like]: like } },
    ];
    const numeric = Number(query);

    if (Number.isFinite(numeric) && query === String(numeric)) {
      conditions.push({ id: numeric });
    }

    where[Op.or] = conditions;
  }

  const users = await User.findAll({
    where,
    attributes: [
      "id",
      "publicUserId",
      "username",
      "name",
      "nickname",
      "phone",
      "gender",
    ],
    order: [["updatedAt", "DESC"]],
    limit: 20,
  });

  return users.map(serializeRevenueUser);
};

export const revenueExcludeUserSql = (userIds = [], column = "userId") =>
  userIds.length > 0 ? ` AND ${column} NOT IN (:excludeUserIds)` : "";
