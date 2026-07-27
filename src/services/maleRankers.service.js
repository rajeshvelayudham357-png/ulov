import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

const getDisplayName = (row) => {
  const name = row.name?.trim();
  const username = row.username?.trim();

  if (name && name !== "New User") {
    return name;
  }

  if (username) {
    return username;
  }

  return name || "User";
};

export const fetchMalePurchaseRankers = async ({
  page = 1,
  limit = 20,
  excludeUserIds = [],
} = {}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const offset = (safePage - 1) * safeLimit;

  const excludeSource =
    excludeUserIds instanceof Set
      ? [...excludeUserIds]
      : Array.isArray(excludeUserIds)
        ? excludeUserIds
        : [];

  const excludeIds = excludeSource
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const excludeClause =
    excludeIds.length > 0
      ? `AND u.id NOT IN (${excludeIds.map(() => "?").join(",")})`
      : "";

  const listReplacements = [...excludeIds, safeLimit, offset];

  const rows = await sequelize.query(
    `SELECT
      u.id,
      u.username,
      u.name,
      u.avatar,
      u.publicUserId,
      u.online,
      SUM(spent.coins) AS totalSpent,
      SUM(spent.coins) AS totalCoins,
      COUNT(spent.id) AS purchaseCount
    FROM (
      SELECT id, callerId AS userId, coinsSpent AS coins FROM call_histories WHERE status = 'completed' AND coinsSpent > 0
      UNION ALL
      SELECT id, senderId AS userId, coinCost AS coins FROM call_gift_records WHERE coinCost > 0
    ) spent
    INNER JOIN users u ON u.id = spent.userId
    WHERE LOWER(u.gender) = 'male'
      ${excludeClause}
    GROUP BY
      u.id,
      u.username,
      u.name,
      u.avatar,
      u.publicUserId,
      u.online
    HAVING SUM(spent.coins) > 0
    ORDER BY totalSpent DESC
    LIMIT ? OFFSET ?`,
    {
      replacements: listReplacements,
      type: QueryTypes.SELECT,
    }
  );

  const countReplacements = [...excludeIds];

  const [countRow] = await sequelize.query(
    `SELECT COUNT(*) AS total
    FROM (
      SELECT u.id
      FROM (
        SELECT id, callerId AS userId, coinsSpent AS coins FROM call_histories WHERE status = 'completed' AND coinsSpent > 0
        UNION ALL
        SELECT id, senderId AS userId, coinCost AS coins FROM call_gift_records WHERE coinCost > 0
      ) spent
      INNER JOIN users u ON u.id = spent.userId
      WHERE LOWER(u.gender) = 'male'
        ${excludeClause}
      GROUP BY u.id
      HAVING SUM(spent.coins) > 0
    ) ranked`,
    {
      replacements: countReplacements,
      type: QueryTypes.SELECT,
    }
  );

  const total = Number(countRow?.total || 0);

  const rankers = rows.map((row, index) => ({
    rank: offset + index + 1,
    userId: Number(row.id),
    username: row.username,
    name: row.name,
    displayName: getDisplayName(row),
    avatar: row.avatar,
    publicUserId: row.publicUserId,
    online: Boolean(row.online),
    totalSpent: Number(row.totalSpent || 0),
    totalCoins: Number(row.totalCoins || 0),
    purchaseCount: Number(row.purchaseCount || 0),
  }));

  return {
    rankers,
    total,
    page: safePage,
    limit: safeLimit,
    hasMore: offset + rankers.length < total,
  };
};

export const fetchMaleTopSupportedCreators = async (maleId, limit = 10) => {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));

  const rows = await sequelize.query(
    `SELECT
      u.id,
      u.username,
      u.name,
      u.avatar,
      u.publicUserId,
      u.online,
      SUM(spent.coins) AS totalCoins
    FROM (
      SELECT receiverId AS creatorId, coinsSpent AS coins 
      FROM call_histories 
      WHERE callerId = ? AND status = 'completed' AND coinsSpent > 0
      
      UNION ALL
      
      SELECT receiverId AS creatorId, coinCost AS coins 
      FROM call_gift_records 
      WHERE senderId = ? AND coinCost > 0
    ) spent
    INNER JOIN users u ON u.id = spent.creatorId
    WHERE LOWER(u.gender) = 'female'
    GROUP BY
      u.id,
      u.username,
      u.name,
      u.avatar,
      u.publicUserId,
      u.online
    HAVING SUM(spent.coins) > 0
    ORDER BY totalCoins DESC
    LIMIT ?`,
    {
      replacements: [maleId, maleId, safeLimit],
      type: QueryTypes.SELECT,
    }
  );

  return rows.map((row, index) => ({
    rank: index + 1,
    creatorId: Number(row.id),
    username: row.username,
    name: row.name,
    displayName: getDisplayName(row),
    avatar: row.avatar,
    publicUserId: row.publicUserId,
    online: Boolean(row.online),
    totalCoins: Number(row.totalCoins || 0),
  }));
};
