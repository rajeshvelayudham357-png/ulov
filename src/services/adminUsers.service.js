import { Op } from "sequelize";

import { User } from "../models/index.js";
import { sequelize } from "../config/database.js";

const isFemaleGender = (gender) =>
  String(gender ?? "").trim().toLowerCase() === "female";

const normalizeAccountStatus = (status, gender) => {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (normalized) {
    return normalized;
  }

  return isFemaleGender(gender) ? "pending" : "active";
};

export const getAdminUserDisplayName = (user = {}) =>
  user.nickname ||
  (user.name && user.name !== "New User" ? user.name : null) ||
  user.username ||
  user.publicUserId ||
  user.phone ||
  `User ${user.id ?? ""}`.trim();

export const buildAdminUsersSearchWhere = (search = "") => {
  const trimmed = String(search || "").trim();

  if (!trimmed) {
    return {};
  }

  const like = `%${trimmed}%`;
  const conditions = [
    { name: { [Op.like]: like } },
    { nickname: { [Op.like]: like } },
    { username: { [Op.like]: like } },
    { publicUserId: { [Op.like]: like } },
    { phone: { [Op.like]: like } },
    { email: { [Op.like]: like } },
    { gender: { [Op.like]: like } },
  ];

  const numericSearch = Number(trimmed);
  if (Number.isFinite(numericSearch) && trimmed === String(numericSearch)) {
    conditions.push({ id: numericSearch });
  }

  return { [Op.or]: conditions };
};

export const formatAdminUserListRow = (user) => {
  const data = user?.toJSON ? user.toJSON() : user;

  return {
    id: data.id,
    publicUserId: data.publicUserId,
    name: data.name,
    username: data.username,
    nickname: data.nickname,
    displayName: getAdminUserDisplayName(data),
    email: data.email,
    phone: data.phone,
    gender: data.gender,
    avatar: data.avatar,
    verificationType: data.verificationType,
    verificationAudioUrl: data.verificationAudioUrl,
    verificationVideoUrl: data.verificationVideoUrl,
    verificationSentence: data.verificationSentence,
    audioVerified: data.audioVerified,
    accountStatus: normalizeAccountStatus(data.accountStatus, data.gender),
    online: data.online,
    lastSeen: data.lastSeen,
    profileCompleted: data.profileCompleted,
    blocked: Boolean(data.blocked),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

const LIST_ATTRIBUTES = [
  "id",
  "publicUserId",
  "name",
  "username",
  "nickname",
  "email",
  "phone",
  "gender",
  "avatar",
  "verificationType",
  "verificationAudioUrl",
  "verificationVideoUrl",
  "verificationSentence",
  "audioVerified",
  "online",
  "lastSeen",
  "profileCompleted",
  "createdAt",
  "updatedAt",
  [sequelize.literal("COALESCE(users.blocked, 0)"), "blocked"],
  [
    sequelize.literal("COALESCE(users.accountStatus, 'pending')"),
    "accountStatus",
  ],
];

export const getAdminUsersList = async ({
  page = 1,
  limit = 25,
  search = "",
} = {}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const offset = (safePage - 1) * safeLimit;
  const where = buildAdminUsersSearchWhere(search);

  const { rows, count } = await User.findAndCountAll({
    where,
    attributes: LIST_ATTRIBUTES,
    order: [["createdAt", "DESC"]],
    limit: safeLimit,
    offset,
    distinct: true,
  });

  return {
    rows: rows.map(formatAdminUserListRow),
    total: count,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(count / safeLimit)),
  };
};
