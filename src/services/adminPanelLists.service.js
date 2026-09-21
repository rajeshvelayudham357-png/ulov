import { QueryTypes } from "sequelize";

import { Kyc } from "../models/index.js";
import { sequelize } from "../config/database.js";
import { getAdminUserDisplayName } from "./adminUsers.service.js";

const SUCCESS_STATUSES = ["PAID", "SUCCESS", "CAPTURED", "credited"];

const paginate = (page, limit, max = 100) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), max);
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
};

const paginatedResult = (rows, total, page, limit) => ({
  rows,
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

export const getAdminKycList = async ({
  page = 1,
  limit = 25,
  search = "",
  status = "all",
} = {}) => {
  const { page: safePage, limit: safeLimit, offset } = paginate(page, limit);
  const whereParts = ["1=1"];
  const replacements = { limit: safeLimit, offset };

  if (status && status !== "all") {
    whereParts.push("k.status = :status");
    replacements.status = status;
  }

  if (String(search || "").trim()) {
    whereParts.push(`(
      k.accountName LIKE :searchLike OR
      k.bankName LIKE :searchLike OR
      k.accountNumber LIKE :searchLike OR
      k.upiId LIKE :searchLike OR
      u.name LIKE :searchLike OR
      u.nickname LIKE :searchLike OR
      u.username LIKE :searchLike OR
      u.phone LIKE :searchLike
    )`);
    replacements.searchLike = `%${String(search).trim()}%`;
  }

  const whereSql = whereParts.join(" AND ");
  const fromSql = `
    FROM Kycs k
    LEFT JOIN users u ON u.id = k.userId
  `;

  const [countRow, rows] = await Promise.all([
    sequelize
      .query(
        `SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`,
        { replacements, type: QueryTypes.SELECT }
      )
      .then((result) => result[0]),
    sequelize.query(
      `SELECT k.*,
              u.id AS user_id,
              u.name AS user_name,
              u.nickname AS user_nickname,
              u.username AS user_username,
              u.phone AS user_phone,
              u.avatar AS user_avatar,
              u.gender AS user_gender
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY k.createdAt DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  const total = Number(countRow?.total) || 0;
  const formatted = rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    accountName: row.accountName,
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    ifsc: row.ifsc,
    upiId: row.upiId,
    status: row.status,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: row.user_id
      ? {
          id: row.user_id,
          name: row.user_name,
          nickname: row.user_nickname,
          username: row.user_username,
          phone: row.user_phone,
          avatar: row.user_avatar,
          gender: row.user_gender,
        }
      : null,
  }));

  return paginatedResult(formatted, total, safePage, safeLimit);
};

export const getAdminPayoutsList = async ({
  page = 1,
  limit = 25,
  search = "",
  status = "all",
  kycStatus = "all",
} = {}) => {
  const { page: safePage, limit: safeLimit, offset } = paginate(page, limit);
  const whereParts = ["LOWER(COALESCE(u.gender, '')) = 'female'"];
  const replacements = { limit: safeLimit, offset };

  if (status && status !== "all") {
    whereParts.push("w.status = :status");
    replacements.status = status;
  }

  if (kycStatus && kycStatus !== "all") {
    whereParts.push("COALESCE(k.status, 'none') = :kycStatus");
    replacements.kycStatus = kycStatus;
  }

  if (String(search || "").trim()) {
    whereParts.push(`(
      u.name LIKE :searchLike OR
      u.nickname LIKE :searchLike OR
      u.username LIKE :searchLike OR
      u.phone LIKE :searchLike OR
      w.upiId LIKE :searchLike OR
      w.accountName LIKE :searchLike OR
      w.accountNumber LIKE :searchLike OR
      k.bankName LIKE :searchLike OR
      k.accountNumber LIKE :searchLike
    )`);
    replacements.searchLike = `%${String(search).trim()}%`;
  }

  const whereSql = whereParts.join(" AND ");
  const fromSql = `
    FROM withdraws w
    INNER JOIN users u ON u.id = w.userId
    LEFT JOIN Kycs k ON k.userId = u.id
  `;

  const [countRow, rows] = await Promise.all([
    sequelize
      .query(
        `SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`,
        { replacements, type: QueryTypes.SELECT }
      )
      .then((result) => result[0]),
    sequelize.query(
      `SELECT w.*,
              u.id AS user_id,
              u.name AS user_name,
              u.nickname AS user_nickname,
              u.username AS user_username,
              u.phone AS user_phone,
              u.avatar AS user_avatar,
              u.gender AS user_gender,
              k.status AS kyc_status,
              k.bankName AS kyc_bankName,
              k.accountNumber AS kyc_accountNumber,
              k.ifsc AS kyc_ifsc,
              k.accountName AS kyc_accountName
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY w.createdAt DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  const total = Number(countRow?.total) || 0;
  const formatted = rows.map((row) => {
    const paymentMethod = row.upiId
      ? "UPI"
      : row.accountNumber || row.kyc_accountNumber
        ? "Bank"
        : "—";
    const paymentDetails =
      row.upiId ||
      [row.kyc_bankName, row.kyc_accountNumber, row.kyc_ifsc]
        .filter(Boolean)
        .join(" · ") ||
      "—";

    return {
      id: row.id,
      userId: row.userId,
      amount: row.amount,
      status: row.status,
      upiId: row.upiId,
      accountName: row.accountName || row.kyc_accountName || "—",
      accountNumber: row.accountNumber || row.kyc_accountNumber || "—",
      ifsc: row.ifsc || row.kyc_ifsc || "—",
      bankName: row.kyc_bankName || "—",
      paymentMethod,
      paymentDetails,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      creator: {
        id: row.user_id,
        displayName: getAdminUserDisplayName({
          id: row.user_id,
          name: row.user_name,
          nickname: row.user_nickname,
          username: row.user_username,
          phone: row.user_phone,
        }),
        phone: row.user_phone || "—",
        avatar: row.user_avatar,
        gender: row.user_gender,
      },
      kycStatus: row.kyc_status || "—",
    };
  });

  return paginatedResult(formatted, total, safePage, safeLimit);
};

export const getAdminCreatorsList = async ({
  page = 1,
  limit = 25,
  search = "",
  online = "all",
  profileCompleted = "all",
  verified = "all",
} = {}) => {
  const { page: safePage, limit: safeLimit, offset } = paginate(page, limit);
  const whereParts = ["LOWER(COALESCE(u.gender, '')) = 'female'"];
  const replacements = { limit: safeLimit, offset };

  if (online === "online") {
    whereParts.push("u.online = 1");
  } else if (online === "offline") {
    whereParts.push("COALESCE(u.online, 0) = 0");
  }

  if (profileCompleted === "completed") {
    whereParts.push("u.profileCompleted = 1");
  } else if (profileCompleted === "pending") {
    whereParts.push("COALESCE(u.profileCompleted, 0) = 0");
  }

  if (verified === "verified") {
    whereParts.push("u.verified = 1");
  } else if (verified === "unverified") {
    whereParts.push("COALESCE(u.verified, 0) = 0");
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

  const whereSql = whereParts.join(" AND ");
  const fromSql = `
    FROM users u
    LEFT JOIN (
      SELECT userId,
             COALESCE(SUM(coins), 0) AS totalCoins,
             COALESCE(SUM(amount), 0) AS totalAmount
      FROM earnings
      GROUP BY userId
    ) e ON e.userId = u.id
  `;

  const [countRow, rows] = await Promise.all([
    sequelize
      .query(
        `SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`,
        { replacements, type: QueryTypes.SELECT }
      )
      .then((result) => result[0]),
    sequelize.query(
      `SELECT u.id,
              u.publicUserId,
              u.name,
              u.nickname,
              u.username,
              u.avatar,
              u.gender,
              u.verified,
              u.profileCompleted,
              u.online,
              u.createdAt,
              COALESCE(e.totalCoins, 0) AS totalCoins,
              COALESCE(e.totalAmount, 0) AS totalAmount
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY u.createdAt DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  const total = Number(countRow?.total) || 0;
  const formatted = rows.map((row) => ({
    id: row.id,
    publicUserId: row.publicUserId,
    name: row.name,
    username: row.username,
    displayName: getAdminUserDisplayName(row),
    nickname:
      row.nickname ||
      (row.name !== "New User" ? row.name : null) ||
      row.username ||
      "Unknown",
    image: row.avatar,
    gender: row.gender,
    verified: row.verified,
    profileCompleted: row.profileCompleted,
    online: row.online,
    createdAt: row.createdAt,
    earnings: {
      coins: Number(row.totalCoins) || 0,
      amount: Number(row.totalAmount) || 0,
    },
  }));

  return paginatedResult(formatted, total, safePage, safeLimit);
};

export const getAdminMaleUsersList = async ({
  page = 1,
  limit = 25,
  search = "",
} = {}) => {
  const { page: safePage, limit: safeLimit, offset } = paginate(page, limit);
  const whereParts = [
    "LOWER(COALESCE(u.gender, '')) = 'male'",
    "COALESCE(u.accountStatus, '') <> 'deleted'",
  ];
  const replacements = {
    limit: safeLimit,
    offset,
    successStatuses: SUCCESS_STATUSES,
  };

  if (String(search || "").trim()) {
    whereParts.push(`(
      u.name LIKE :searchLike OR
      u.nickname LIKE :searchLike OR
      u.username LIKE :searchLike OR
      u.phone LIKE :searchLike OR
      u.email LIKE :searchLike OR
      u.publicUserId LIKE :searchLike OR
      CAST(u.id AS CHAR) LIKE :searchLike
    )`);
    replacements.searchLike = `%${String(search).trim()}%`;
  }

  const whereSql = whereParts.join(" AND ");
  const fromSql = `
    FROM users u
    LEFT JOIN wallets w ON w.userId = u.id
    LEFT JOIN (
      SELECT userId,
             SUM(amount) AS totalRechargeAmount,
             SUM(coins) AS totalRechargeCoins,
             COUNT(*) AS rechargeCount,
             MAX(updatedAt) AS latestRechargeAt
      FROM payment_orders
      WHERE status IN (:successStatuses)
      GROUP BY userId
    ) recharge ON recharge.userId = u.id
    LEFT JOIN (
      SELECT po.userId, po.orderId, po.paymentMethod, po.updatedAt
      FROM payment_orders po
      INNER JOIN (
        SELECT userId, MAX(updatedAt) AS maxUpdatedAt
        FROM payment_orders
        WHERE status IN (:successStatuses)
        GROUP BY userId
      ) latest ON latest.userId = po.userId AND latest.maxUpdatedAt = po.updatedAt
      WHERE po.status IN (:successStatuses)
    ) latestPayment ON latestPayment.userId = u.id
  `;

  const [countRow, rows, [summaryRow]] = await Promise.all([
    sequelize
      .query(
        `SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`,
        { replacements, type: QueryTypes.SELECT }
      )
      .then((result) => result[0]),
    sequelize.query(
      `SELECT u.id,
              u.publicUserId,
              u.name,
              u.nickname,
              u.username,
              u.phone,
              u.email,
              u.avatar,
              u.gender,
              u.online,
              u.createdAt,
              COALESCE(w.balance, 0) AS walletBalance,
              COALESCE(recharge.totalRechargeAmount, 0) AS totalRechargeAmount,
              COALESCE(recharge.totalRechargeCoins, 0) AS totalRechargeCoins,
              COALESCE(recharge.rechargeCount, 0) AS rechargeCount,
              recharge.latestRechargeAt,
              latestPayment.orderId AS latestOrderId,
              latestPayment.paymentMethod AS latestPaymentMethod,
              latestPayment.updatedAt AS latestPaymentAt
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY u.createdAt DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COUNT(*) AS totalUsers,
              COALESCE(SUM(recharge.totalRechargeAmount), 0) AS totalRechargeAmount,
              COALESCE(SUM(recharge.totalRechargeCoins), 0) AS totalRechargeCoins,
              COALESCE(SUM(recharge.rechargeCount), 0) AS totalRecharges,
              COALESCE(SUM(w.balance), 0) AS walletBalance
       ${fromSql}
       WHERE ${whereSql}`,
      { replacements, type: QueryTypes.SELECT }
    ),
  ]);

  const total = Number(countRow?.total) || 0;
  const formattedRows = rows.map((row) => ({
    id: row.id,
    publicUserId: row.publicUserId,
    displayName: getAdminUserDisplayName(row),
    name: row.name,
    username: row.username,
    phone: row.phone,
    email: row.email,
    avatar: row.avatar,
    gender: row.gender,
    online: Boolean(row.online),
    walletBalance: Number(row.walletBalance) || 0,
    totalRechargeAmount: Number(row.totalRechargeAmount) || 0,
    totalRechargeCoins: Number(row.totalRechargeCoins) || 0,
    rechargeCount: Number(row.rechargeCount) || 0,
    latestRechargeAt: row.latestRechargeAt || row.latestPaymentAt || null,
    latestOrderId: row.latestOrderId || "—",
    latestPaymentMethod: row.latestPaymentMethod || "—",
    createdAt: row.createdAt,
  }));

  return {
    ...paginatedResult(formattedRows, total, safePage, safeLimit),
    summary: {
      totalUsers: Number(summaryRow?.totalUsers) || 0,
      totalRechargeAmount: Number(summaryRow?.totalRechargeAmount) || 0,
      totalRechargeCoins: Number(summaryRow?.totalRechargeCoins) || 0,
      totalRecharges: Number(summaryRow?.totalRecharges) || 0,
      walletBalance: Number(summaryRow?.walletBalance) || 0,
    },
  };
};
