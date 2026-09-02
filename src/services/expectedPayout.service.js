import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

const toAmount = (value) => Number(Number(value || 0).toFixed(2));

const getDisplayName = (row) =>
  String(row?.nickname || "").trim() ||
  (String(row?.name || "").trim() !== "New User"
    ? String(row?.name || "").trim()
    : "") ||
  String(row?.username || "").trim() ||
  "Unknown";

export const getExpectedPayoutReport = async ({
  creatorId = null,
  search = "",
} = {}) => {
  const normalizedCreatorId = Number(creatorId);
  const hasCreatorId = Number.isFinite(normalizedCreatorId) && normalizedCreatorId > 0;
  const searchTerm = String(search || "").trim().toLowerCase();

  const replacements = {};

  let creatorFilterClause = "";
  if (hasCreatorId) {
    creatorFilterClause = "AND u.id = :creatorId";
    replacements.creatorId = normalizedCreatorId;
  }

  const rows = await sequelize.query(
    `SELECT *
     FROM (
       SELECT
         u.id AS creatorId,
         u.publicUserId,
         u.name,
         u.nickname,
         u.username,
         u.phone,
         u.avatar,
         u.accountStatus,
         COALESCE(earn.totalEarned, 0) AS totalEarned,
         COALESCE(wd.approvedWithdrawals, 0) AS approvedWithdrawals,
         COALESCE(wd.pendingWithdrawals, 0) AS pendingWithdrawals,
         GREATEST(
           0,
           COALESCE(earn.totalEarned, 0)
             - COALESCE(wd.approvedWithdrawals, 0)
             - COALESCE(wd.pendingWithdrawals, 0)
         ) AS expectedPayout,
         kyc.kycStatus
       FROM users u
       LEFT JOIN (
         SELECT userId, SUM(amount) AS totalEarned
         FROM earnings
         GROUP BY userId
       ) earn ON earn.userId = u.id
       LEFT JOIN (
         SELECT
           userId,
           SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) AS approvedWithdrawals,
           SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS pendingWithdrawals
         FROM withdraws
         GROUP BY userId
       ) wd ON wd.userId = u.id
       LEFT JOIN (
         SELECT k1.userId, k1.status AS kycStatus
         FROM Kycs k1
         INNER JOIN (
           SELECT userId, MAX(id) AS maxId
           FROM Kycs
           GROUP BY userId
         ) latest ON latest.maxId = k1.id
       ) kyc ON kyc.userId = u.id
       WHERE LOWER(COALESCE(u.gender, '')) = 'female'
         AND COALESCE(u.accountStatus, '') <> 'deleted'
         ${creatorFilterClause}
     ) creator_balances
     WHERE (
       totalEarned > 0
       OR approvedWithdrawals > 0
       OR pendingWithdrawals > 0
     )
     ORDER BY expectedPayout DESC, totalEarned DESC, creatorId DESC`,
    {
      replacements,
      type: QueryTypes.SELECT,
    }
  );

  let creators = rows.map((row) => ({
    id: Number(row.creatorId),
    publicUserId: row.publicUserId || null,
    displayName: getDisplayName(row),
    phone: row.phone || "",
    avatar: row.avatar || null,
    accountStatus: row.accountStatus || "pending",
    totalEarned: toAmount(row.totalEarned),
    approvedWithdrawals: toAmount(row.approvedWithdrawals),
    pendingWithdrawals: toAmount(row.pendingWithdrawals),
    totalWithdrawals: toAmount(
      Number(row.approvedWithdrawals || 0) + Number(row.pendingWithdrawals || 0)
    ),
    expectedPayout: toAmount(row.expectedPayout),
    kycStatus: row.kycStatus || "not_submitted",
  }));

  if (searchTerm) {
    const compactSearch = searchTerm.replace(/[^a-z0-9]/g, "");
    creators = creators.filter((creator) => {
      const haystack = [
        creator.id,
        creator.publicUserId,
        creator.displayName,
        creator.phone,
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

  const summary = creators.reduce(
    (acc, creator) => {
      acc.totalEarned += creator.totalEarned;
      acc.totalApprovedWithdrawals += creator.approvedWithdrawals;
      acc.totalPendingWithdrawals += creator.pendingWithdrawals;
      acc.totalExpectedPayout += creator.expectedPayout;
      return acc;
    },
    {
      creatorCount: creators.length,
      totalEarned: 0,
      totalApprovedWithdrawals: 0,
      totalPendingWithdrawals: 0,
      totalExpectedPayout: 0,
    }
  );

  summary.totalEarned = toAmount(summary.totalEarned);
  summary.totalApprovedWithdrawals = toAmount(summary.totalApprovedWithdrawals);
  summary.totalPendingWithdrawals = toAmount(summary.totalPendingWithdrawals);
  summary.totalExpectedPayout = toAmount(summary.totalExpectedPayout);

  return {
    summary,
    creators,
  };
};
