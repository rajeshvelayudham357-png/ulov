import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

const SUCCESS_STATUSES = ["PAID", "SUCCESS", "CAPTURED", "credited"];

const toCoins = (value) => Number(value || 0);

const getDisplayName = (row) =>
  String(row?.nickname || "").trim() ||
  (String(row?.name || "").trim() !== "New User"
    ? String(row?.name || "").trim()
    : "") ||
  String(row?.username || "").trim() ||
  "Unknown";

const paginate = (page, limit, max = 100) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), max);
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
};

const buildWhereClause = ({
  search = "",
  minBalance = null,
  onlyWithBalance = false,
  balanceFilter = "all",
} = {}) => {
  const whereParts = [
    "LOWER(COALESCE(u.gender, '')) = 'male'",
    "COALESCE(u.accountStatus, '') <> 'deleted'",
  ];
  const replacements = { successStatuses: SUCCESS_STATUSES };

  if (onlyWithBalance || balanceFilter === "positive") {
    whereParts.push("COALESCE(w.balance, 0) > 0");
  } else if (balanceFilter === "zero") {
    whereParts.push("COALESCE(w.balance, 0) <= 0");
  }

  const minBalanceValue =
    minBalance == null || minBalance === ""
      ? null
      : Math.max(0, Number(minBalance) || 0);

  if (minBalanceValue != null) {
    whereParts.push("COALESCE(w.balance, 0) >= :minBalance");
    replacements.minBalance = minBalanceValue;
  }

  if (String(search || "").trim()) {
    whereParts.push(`(
      u.name LIKE :searchLike OR
      u.nickname LIKE :searchLike OR
      u.username LIKE :searchLike OR
      u.phone LIKE :searchLike OR
      u.publicUserId LIKE :searchLike OR
      CAST(u.id AS CHAR) LIKE :searchLike
    )`);
    replacements.searchLike = `%${String(search).trim()}%`;
  }

  return {
    whereSql: whereParts.join(" AND "),
    replacements,
  };
};

const fromSql = `
  FROM users u
  LEFT JOIN wallets w ON w.userId = u.id
  LEFT JOIN (
    SELECT
      userId,
      SUM(amount) AS totalRechargeAmount,
      SUM(coins) AS totalRechargeCoins,
      COUNT(*) AS rechargeCount
    FROM payment_orders
    WHERE status IN (:successStatuses)
    GROUP BY userId
  ) recharge ON recharge.userId = u.id
  LEFT JOIN (
    SELECT
      userId,
      ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)) AS coinsSpent
    FROM wallet_transactions
    GROUP BY userId
  ) spent ON spent.userId = u.id
`;

export const getMaleWalletCoinsReport = async ({
  search = "",
  minBalance = null,
  onlyWithBalance = false,
  balanceFilter = "all",
  page = 1,
  limit = 25,
} = {}) => {
  const { page: safePage, limit: safeLimit, offset } = paginate(page, limit);
  const { whereSql, replacements } = buildWhereClause({
    search,
    minBalance,
    onlyWithBalance,
    balanceFilter,
  });

  const pagingReplacements = {
    ...replacements,
    limit: safeLimit,
    offset,
  };

  const [countRow, rows, [summaryRow]] = await Promise.all([
    sequelize
      .query(`SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`, {
        replacements,
        type: QueryTypes.SELECT,
      })
      .then((result) => result[0]),
    sequelize.query(
      `SELECT
         u.id AS userId,
         u.publicUserId,
         u.name,
         u.nickname,
         u.username,
         u.phone,
         u.avatar,
         u.online,
         u.lastLoginAt,
         COALESCE(w.balance, 0) AS walletBalance,
         COALESCE(recharge.totalRechargeAmount, 0) AS totalRechargeAmount,
         COALESCE(recharge.totalRechargeCoins, 0) AS totalRechargeCoins,
         COALESCE(recharge.rechargeCount, 0) AS rechargeCount,
         COALESCE(spent.coinsSpent, 0) AS coinsSpent
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY walletBalance DESC, u.id DESC
       LIMIT :limit OFFSET :offset`,
      {
        replacements: pagingReplacements,
        type: QueryTypes.SELECT,
      }
    ),
    sequelize.query(
      `SELECT
         COUNT(*) AS maleCount,
         SUM(CASE WHEN COALESCE(w.balance, 0) > 0 THEN 1 ELSE 0 END) AS malesWithBalance,
         COALESCE(SUM(COALESCE(w.balance, 0)), 0) AS totalWalletCoins,
         COALESCE(SUM(COALESCE(spent.coinsSpent, 0)), 0) AS totalCoinsSpent,
         COALESCE(SUM(COALESCE(recharge.totalRechargeCoins, 0)), 0) AS totalRechargeCoins
       ${fromSql}
       WHERE ${whereSql}`,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    ),
  ]);

  const users = rows.map((row) => ({
    id: Number(row.userId),
    publicUserId: row.publicUserId || null,
    displayName: getDisplayName(row),
    phone: row.phone || "",
    avatar: row.avatar || null,
    online: Boolean(row.online),
    lastLoginAt: row.lastLoginAt || null,
    walletBalance: toCoins(row.walletBalance),
    totalRechargeAmount: Number(Number(row.totalRechargeAmount || 0).toFixed(2)),
    totalRechargeCoins: toCoins(row.totalRechargeCoins),
    rechargeCount: Number(row.rechargeCount) || 0,
    coinsSpent: toCoins(row.coinsSpent),
  }));

  const total = Number(countRow?.total) || 0;

  return {
    summary: {
      maleCount: Number(summaryRow?.maleCount) || 0,
      malesWithBalance: Number(summaryRow?.malesWithBalance) || 0,
      totalWalletCoins: toCoins(summaryRow?.totalWalletCoins),
      totalCoinsSpent: toCoins(summaryRow?.totalCoinsSpent),
      totalRechargeCoins: toCoins(summaryRow?.totalRechargeCoins),
    },
    users,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
};
