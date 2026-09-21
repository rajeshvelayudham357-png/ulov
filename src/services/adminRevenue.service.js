import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { splitInclusiveGst } from "./gstSettings.service.js";
import { revenueExcludeUserSql } from "./revenueExcludeUsers.service.js";
import { istDateKeyToUtcRange } from "./adminRevenueTime.service.js";

export const SUCCESS_PAYMENT_STATUSES = [
  "PAID",
  "SUCCESS",
  "CAPTURED",
  "credited",
];

const toAmount = (value) => Number(Number(value || 0).toFixed(2));

export const getRevenueDisplayName = (user = {}) =>
  user.nickname ||
  (user.name && user.name !== "New User" ? user.name : null) ||
  user.username ||
  user.publicUserId ||
  user.phone ||
  `User ${user.id ?? ""}`.trim();

const buildOrderFilter = ({
  excludeUserIds = [],
  gateway = "",
  status = "",
  startDate = "",
  endDate = "",
  minAmount = 0,
  maxAmount = 0,
  search = "",
  tableAlias = "po",
} = {}) => {
  const clauses = [`${tableAlias}.status IN (:statuses)`];
  const replacements = {
    statuses: SUCCESS_PAYMENT_STATUSES,
  };

  if (excludeUserIds.length > 0) {
    clauses.push(`${tableAlias}.userId NOT IN (:excludeUserIds)`);
    replacements.excludeUserIds = excludeUserIds;
  }

  if (gateway) {
    clauses.push(`${tableAlias}.gateway = :gateway`);
    replacements.gateway = gateway;
  }

  if (status && SUCCESS_PAYMENT_STATUSES.includes(status)) {
    replacements.statuses = [status];
  }

  if (startDate) {
    clauses.push(`${tableAlias}.updatedAt >= :fromUtc`);
    replacements.fromUtc = istDateKeyToUtcRange(startDate).start;
  }

  if (endDate) {
    clauses.push(`${tableAlias}.updatedAt <= :toUtc`);
    replacements.toUtc = istDateKeyToUtcRange(endDate).end;
  }

  if (minAmount > 0) {
    clauses.push(`${tableAlias}.amount >= :minAmount`);
    replacements.minAmount = minAmount;
  }

  if (maxAmount > 0) {
    clauses.push(`${tableAlias}.amount <= :maxAmount`);
    replacements.maxAmount = maxAmount;
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    const like = `%${trimmedSearch}%`;
    replacements.searchLike = like;

    const searchParts = [
      `${tableAlias}.orderId LIKE :searchLike`,
      `${tableAlias}.cashfreePaymentId LIKE :searchLike`,
      `${tableAlias}.razorpayPaymentId LIKE :searchLike`,
      `u.name LIKE :searchLike`,
      `u.nickname LIKE :searchLike`,
      `u.username LIKE :searchLike`,
      `u.phone LIKE :searchLike`,
      `u.publicUserId LIKE :searchLike`,
    ];

    const numericSearch = Number(trimmedSearch);
    if (
      Number.isFinite(numericSearch) &&
      trimmedSearch === String(numericSearch)
    ) {
      replacements.searchAmount = numericSearch;
      searchParts.push(`${tableAlias}.amount = :searchAmount`);
    }

    clauses.push(`(${searchParts.join(" OR ")})`);
  }

  return {
    whereSql: clauses.join(" AND "),
    replacements,
    hasSearch: Boolean(trimmedSearch),
  };
};

const loadWalletMaps = async (userIds = []) => {
  if (userIds.length === 0) {
    return { walletMap: {}, coinsUsedMap: {} };
  }

  const [wallets, usedRows] = await Promise.all([
    sequelize.query(
      `SELECT userId, balance
       FROM wallets
       WHERE userId IN (:userIds)`,
      {
        replacements: { userIds },
        type: QueryTypes.SELECT,
      }
    ),
    sequelize.query(
      `SELECT userId,
              ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)) AS coinsUsed
       FROM wallet_transactions
       WHERE userId IN (:userIds)
         AND amount < 0
       GROUP BY userId`,
      {
        replacements: { userIds },
        type: QueryTypes.SELECT,
      }
    ),
  ]);

  const walletMap = {};
  wallets.forEach((row) => {
    walletMap[row.userId] = Number(row.balance) || 0;
  });

  const coinsUsedMap = {};
  usedRows.forEach((row) => {
    coinsUsedMap[row.userId] = Number(row.coinsUsed) || 0;
  });

  return { walletMap, coinsUsedMap };
};

export const getRevenueRechargesReport = async ({
  page = 1,
  limit = 25,
  isExport = false,
  search = "",
  gateway = "",
  status = "",
  startDate = "",
  endDate = "",
  minAmount = 0,
  maxAmount = 0,
  excludeUserIds = [],
  gstPercent = 0,
} = {}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const offset = (safePage - 1) * safeLimit;

  const filter = buildOrderFilter({
    excludeUserIds,
    gateway,
    status,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    search,
  });

  const joinUsers = filter.hasSearch
    ? "LEFT JOIN users u ON u.id = po.userId"
    : "";

  const [summaryRow] = await sequelize.query(
    `SELECT COUNT(*) AS totalRecharges,
            COALESCE(SUM(po.amount), 0) AS totalAmount,
            COALESCE(SUM(po.coins), 0) AS totalCoins
     FROM payment_orders po
     ${joinUsers}
     WHERE ${filter.whereSql}`,
    {
      replacements: filter.replacements,
      type: QueryTypes.SELECT,
    }
  );

  const totalRecharges = Number(summaryRow?.totalRecharges) || 0;
  const totalAmountRaw = Number(summaryRow?.totalAmount) || 0;
  const totalCoins = Number(summaryRow?.totalCoins) || 0;
  const { gstAmount: totalGst, baseRevenue: totalNetRevenue } = splitInclusiveGst(
    totalAmountRaw,
    gstPercent
  );

  const listSql = `
    SELECT po.id,
           po.orderId,
           po.userId,
           po.amount,
           po.coins,
           po.gateway,
           po.status,
           po.paymentMethod,
           po.updatedAt,
           po.cashfreePaymentId,
           po.razorpayPaymentId,
           u.publicUserId,
           u.name,
           u.nickname,
           u.username,
           u.phone
    FROM payment_orders po
    LEFT JOIN users u ON u.id = po.userId
    WHERE ${filter.whereSql}
    ORDER BY po.updatedAt DESC
    ${isExport ? "" : "LIMIT :limit OFFSET :offset"}
  `;

  const listReplacements = {
    ...filter.replacements,
  };

  if (!isExport) {
    listReplacements.limit = safeLimit;
    listReplacements.offset = offset;
  }

  const orderRows = await sequelize.query(listSql, {
    replacements: listReplacements,
    type: QueryTypes.SELECT,
  });

  const userIds = [...new Set(orderRows.map((row) => row.userId))];
  const { walletMap, coinsUsedMap } = await loadWalletMaps(userIds);

  const rows = orderRows.map((row) => {
    const { gstAmount, baseRevenue } = splitInclusiveGst(
      Number(row.amount) || 0,
      gstPercent
    );

    return {
      id: row.id,
      orderId: row.orderId,
      userId: row.userId,
      publicUserId: row.publicUserId,
      userName: getRevenueDisplayName(row),
      phone: row.phone || "—",
      rechargeDate: row.updatedAt,
      amount: Number(row.amount) || 0,
      gstPercent,
      gstAmount,
      netRevenue: baseRevenue,
      coinsPurchased: Number(row.coins) || 0,
      coinsUsed: coinsUsedMap[row.userId] || 0,
      walletBalance: walletMap[row.userId] ?? 0,
      gateway: row.gateway || "cashfree",
      transactionId:
        row.cashfreePaymentId || row.razorpayPaymentId || row.orderId || "—",
      status: row.status,
      paymentMethod: row.paymentMethod || "—",
    };
  });

  return {
    rows,
    total: totalRecharges,
    page: safePage,
    limit: isExport ? totalRecharges : safeLimit,
    totalPages: Math.max(
      1,
      Math.ceil(totalRecharges / (isExport ? totalRecharges || 1 : safeLimit))
    ),
    summary: {
      totalRecharges,
      totalAmount: totalAmountRaw,
      totalGst,
      totalNetRevenue,
      totalCoins,
      gstPercent,
    },
  };
};

const buildDateSql = (column, startDate, endDate, replacements) => {
  const parts = [];

  if (startDate) {
    parts.push(`${column} >= :fromUtc`);
    replacements.fromUtc = istDateKeyToUtcRange(startDate).start;
  }

  if (endDate) {
    parts.push(`${column} <= :toUtc`);
    replacements.toUtc = istDateKeyToUtcRange(endDate).end;
  }

  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
};

export const getRevenueSummaryReport = async ({
  startDate = "",
  endDate = "",
  excludeUserIds = [],
  gstPercent = 0,
} = {}) => {
  const orderReplacements = {
    statuses: SUCCESS_PAYMENT_STATUSES,
  };
  const orderWhereParts = ["status IN (:statuses)"];

  if (excludeUserIds.length > 0) {
    orderWhereParts.push("userId NOT IN (:excludeUserIds)");
    orderReplacements.excludeUserIds = excludeUserIds;
  }

  const orderWhereSql =
    orderWhereParts.join(" AND ") +
    buildDateSql("updatedAt", startDate, endDate, orderReplacements);

  const [aggregateRow] = await sequelize.query(
    `SELECT COUNT(*) AS rechargeCount,
            COUNT(DISTINCT userId) AS maleUsersRecharged,
            COALESCE(SUM(amount), 0) AS totalAmount,
            COALESCE(SUM(coins), 0) AS totalCoins
     FROM payment_orders
     WHERE ${orderWhereSql}`,
    {
      replacements: orderReplacements,
      type: QueryTypes.SELECT,
    }
  );

  const gatewayRows = await sequelize.query(
    `SELECT gateway,
            COUNT(*) AS count,
            COALESCE(SUM(amount), 0) AS amount
     FROM payment_orders
     WHERE ${orderWhereSql}
     GROUP BY gateway`,
    {
      replacements: orderReplacements,
      type: QueryTypes.SELECT,
    }
  );

  const totalAmount = Number(aggregateRow?.totalAmount) || 0;
  const totalCoins = Number(aggregateRow?.totalCoins) || 0;
  const rechargeCount = Number(aggregateRow?.rechargeCount) || 0;
  const maleUsersRecharged = Number(aggregateRow?.maleUsersRecharged) || 0;
  const { gstAmount: totalGst, baseRevenue: totalNetRevenue } = splitInclusiveGst(
    totalAmount,
    gstPercent
  );

  const gatewayCounts = {};
  const gatewayAmounts = {};
  gatewayRows.forEach((row) => {
    const gateway = row.gateway || "cashfree";
    gatewayCounts[gateway] = Number(row.count) || 0;
    gatewayAmounts[gateway] = Number(row.amount) || 0;
  });

  const sqlReplacements = { ...orderReplacements };
  const userExcludeSql = revenueExcludeUserSql(excludeUserIds);
  const dateSql = (column) =>
    buildDateSql(column, startDate, endDate, sqlReplacements);

  const [[coinsUsedRow], [walletRow], [earningRow], [approvedPayoutRow], [pendingPayoutRow]] =
    await Promise.all([
      sequelize.query(
        `SELECT ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)) AS coinsUsed
         FROM wallet_transactions
         WHERE amount < 0${dateSql("createdAt")}${userExcludeSql}`,
        { replacements: sqlReplacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT SUM(balance) AS totalBalance
         FROM wallets
         WHERE 1=1${userExcludeSql}`,
        { replacements: sqlReplacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT SUM(amount) AS totalEarnings
         FROM earnings
         WHERE 1=1${dateSql("createdAt")}${userExcludeSql}`,
        { replacements: sqlReplacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT SUM(amount) AS total
         FROM withdraws
         WHERE status='approved'${dateSql("updatedAt")}${userExcludeSql}`,
        { replacements: sqlReplacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT SUM(amount) AS total
         FROM withdraws
         WHERE status='pending'${dateSql("createdAt")}${userExcludeSql}`,
        { replacements: sqlReplacements, type: QueryTypes.SELECT }
      ),
    ]);

  const totalCoinsUsed = Number(coinsUsedRow?.coinsUsed) || 0;
  const totalWalletBalance = Number(walletRow?.totalBalance) || 0;
  const totalCreatorEarnings = Number(earningRow?.totalEarnings) || 0;
  const approvedPayout = Number(approvedPayoutRow?.total) || 0;
  const pendingPayout = Number(pendingPayoutRow?.total) || 0;
  const remainingRevenue = totalNetRevenue - approvedPayout;
  const avgRecharge = rechargeCount > 0 ? totalAmount / rechargeCount : 0;
  const avgRevenuePerUser =
    maleUsersRecharged > 0 ? totalNetRevenue / maleUsersRecharged : 0;

  const allGateways = ["cashfree", "razorpay", "payu", "phonepe", "google_play"];
  const gatewayLabel = (gw) => {
    if (gw === "google_play") return "Google Play";
    if (gw === "razorpay") return "Razorpay";
    if (gw === "payu") return "PayU";
    if (gw === "phonepe") return "PhonePe";
    return "Cashfree";
  };

  const gatewayPie = allGateways.map((gw) => ({
    name: gatewayLabel(gw),
    value: gatewayAmounts[gw] || 0,
    count: gatewayCounts[gw] || 0,
    percentage:
      totalAmount > 0
        ? (((gatewayAmounts[gw] || 0) / totalAmount) * 100).toFixed(1)
        : "0.0",
  }));

  return {
    cards: {
      totalAmount: toAmount(totalAmount),
      totalGst: toAmount(totalGst),
      totalNetRevenue: toAmount(totalNetRevenue),
      totalCoins,
      totalCoinsUsed,
      totalWalletBalance,
      totalCreatorEarnings: toAmount(totalCreatorEarnings),
      approvedPayout: toAmount(approvedPayout),
      pendingPayout: toAmount(pendingPayout),
      remainingRevenue: toAmount(remainingRevenue),
      rechargeCount,
      avgRecharge: toAmount(avgRecharge),
      avgRevenuePerUser: toAmount(avgRevenuePerUser),
      maleUsersRecharged,
      gstPercent,
    },
    breakdown: {
      rechargeRevenue: toAmount(totalAmount),
      gst: toAmount(totalGst),
      netRevenue: toAmount(totalNetRevenue),
      creatorEarnings: toAmount(totalCreatorEarnings),
      approvedPayout: toAmount(approvedPayout),
      pendingPayout: toAmount(pendingPayout),
      remainingRevenue: toAmount(remainingRevenue),
      platformRevenue: toAmount(totalNetRevenue - totalCreatorEarnings),
    },
    gatewayPie,
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
  };
};
