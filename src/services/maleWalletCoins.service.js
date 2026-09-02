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

export const getMaleWalletCoinsReport = async ({
  search = "",
  minBalance = null,
  onlyWithBalance = false,
} = {}) => {
  const searchTerm = String(search || "").trim().toLowerCase();
  const minBalanceValue =
    minBalance == null || minBalance === ""
      ? null
      : Math.max(0, Number(minBalance) || 0);

  const rows = await sequelize.query(
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
     WHERE LOWER(COALESCE(u.gender, '')) = 'male'
       AND COALESCE(u.accountStatus, '') <> 'deleted'
     ORDER BY walletBalance DESC, u.id DESC`,
    {
      replacements: {
        successStatuses: SUCCESS_STATUSES,
      },
      type: QueryTypes.SELECT,
    }
  );

  let users = rows.map((row) => ({
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

  if (onlyWithBalance) {
    users = users.filter((user) => user.walletBalance > 0);
  }

  if (minBalanceValue != null) {
    users = users.filter((user) => user.walletBalance >= minBalanceValue);
  }

  if (searchTerm) {
    const compactSearch = searchTerm.replace(/[^a-z0-9]/g, "");
    users = users.filter((user) => {
      const haystack = [
        user.id,
        user.publicUserId,
        user.displayName,
        user.phone,
        user.walletBalance,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return haystack.some((value) => {
        const compactValue = value.replace(/[^a-z0-9]/g, "");
        return (
          value.includes(searchTerm) ||
          (compactSearch && compactValue.includes(compactSearch))
        );
      });
    });
  }

  const summary = users.reduce(
    (acc, user) => {
      acc.maleCount += 1;
      acc.totalWalletCoins += user.walletBalance;
      acc.totalCoinsSpent += user.coinsSpent;
      acc.totalRechargeCoins += user.totalRechargeCoins;
      if (user.walletBalance > 0) {
        acc.malesWithBalance += 1;
      }
      return acc;
    },
    {
      maleCount: 0,
      malesWithBalance: 0,
      totalWalletCoins: 0,
      totalCoinsSpent: 0,
      totalRechargeCoins: 0,
    }
  );

  return {
    summary,
    users,
  };
};
