import { Op } from "sequelize";

import { User } from "../models/index.js";
import { attachCreatorCallRates } from "./callRate.service.js";
import { getAppSettings } from "./appSettings.service.js";
import { getFemaleRatingStatsMap } from "./ratingStats.service.js";
import { ensureColumn } from "./schemaUtil.service.js";

export const STAR_FRIENDS_COUNT = 3;
export const STAR_FRIENDS_NEW_USER_DAYS = 14;

const parseStarFriendsCallMode = (value) => {
  const mode = String(value || "both").trim().toLowerCase();

  if (mode === "voice" || mode === "audio") {
    return "voice";
  }

  if (mode === "video") {
    return "video";
  }

  return "both";
};

const femaleUserWhere = {
  gender: {
    [Op.in]: ["Female", "female"],
  },
};

let userFlagReady = false;

const ensureStarFriendsUserFlag = async () => {
  if (userFlagReady) {
    return;
  }

  await ensureColumn(
    "users",
    "starFriendsPopupSeen",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );
  userFlagReady = true;
};

export const parseStarFriendsUserIds = (value) => {
  let ids = value;

  if (typeof ids === "string" && ids.trim()) {
    try {
      ids = JSON.parse(ids);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(ids)) {
    return [];
  }

  const unique = [];

  for (const item of ids) {
    const id = Number(item);

    if (!Number.isFinite(id) || id <= 0 || unique.includes(id)) {
      continue;
    }

    unique.push(id);

    if (unique.length >= STAR_FRIENDS_COUNT) {
      break;
    }
  }

  return unique;
};

export const serializeStarFriendsAdminUser = (user) => {
  const data = user.toJSON ? user.toJSON() : user;

  return {
    id: Number(data.id),
    publicUserId: data.publicUserId || null,
    displayName:
      data.nickname || data.username || data.name || `User ${data.id}`,
    username: data.username || "",
    phone: data.phone || "",
    avatar: data.avatar || null,
    online: Boolean(data.online),
    accountStatus: data.accountStatus || "",
    verified: Boolean(data.verified),
  };
};

const serializeStarFriendsProfile = (data, stats) => ({
  id: Number(data.id),
  username: data.username || data.nickname || data.name || `User ${data.id}`,
  name: data.nickname || data.username || data.name || `User ${data.id}`,
  avatar: data.avatar || null,
  gender: "Female",
  verified: Boolean(data.verified),
  online: Boolean(data.online),
  status: data.online ? "online" : "offline",
  accountStatus: data.accountStatus || "approved",
  ratingScore: Number(stats?.ratingScore) || 0,
  ratingCount: Number(stats?.ratingCount) || 0,
  voiceRatePerMinute: data.voiceRatePerMinute,
  videoRatePerMinute: data.videoRatePerMinute,
  acceptVoiceCalls:
    data.acceptVoiceCalls === undefined || data.acceptVoiceCalls === null
      ? true
      : Boolean(data.acceptVoiceCalls),
  acceptVideoCalls:
    data.acceptVideoCalls === undefined || data.acceptVideoCalls === null
      ? true
      : Boolean(data.acceptVideoCalls),
});

const isApprovedFemale = (user) => {
  const data = user.toJSON ? user.toJSON() : user;
  const gender = String(data.gender || "").toLowerCase();
  const status = String(data.accountStatus || "approved").toLowerCase();

  return gender === "female" && status === "approved";
};

const isNewMaleUser = (user, now = Date.now()) => {
  const createdMs = new Date(user.createdAt).getTime();

  if (!Number.isFinite(createdMs)) {
    return true;
  }

  return now - createdMs <= STAR_FRIENDS_NEW_USER_DAYS * 24 * 60 * 60 * 1000;
};

const loadStarFriendsUsers = async (userIds) => {
  const ids = parseStarFriendsUserIds(userIds);

  if (!ids.length) {
    return [];
  }

  const users = await User.findAll({
    where: {
      id: { [Op.in]: ids },
      ...femaleUserWhere,
    },
    attributes: [
      "id",
      "publicUserId",
      "username",
      "name",
      "nickname",
      "phone",
      "avatar",
      "gender",
      "verified",
      "online",
      "accountStatus",
      "acceptVoiceCalls",
      "acceptVideoCalls",
    ],
  });

  const byId = new Map(users.map((user) => [Number(user.id), user]));

  return ids.map((id) => byId.get(id)).filter(Boolean);
};

export const getStarFriendsProfiles = async (userIds) => {
  const ordered = await loadStarFriendsUsers(userIds);
  const approved = ordered.filter(isApprovedFemale);

  if (!approved.length) {
    return [];
  }

  const withRates = await attachCreatorCallRates(approved);
  const ratingMap = await getFemaleRatingStatsMap();

  return withRates.map((data) =>
    serializeStarFriendsProfile(
      data,
      ratingMap.get(Number(data.id)) || { ratingScore: 0, ratingCount: 0 }
    )
  );
};

export const searchStarFriendsCandidates = async (search = "") => {
  const where = {
    ...femaleUserWhere,
    [Op.or]: [
      {
        accountStatus: {
          [Op.in]: ["approved", "Approved"],
        },
      },
      { verified: true },
      { verified: 1 },
    ],
  };
  const query = String(search || "").trim();

  if (query) {
    where[Op.and] = [
      {
        [Op.or]: [
          { name: { [Op.like]: `%${query}%` } },
          { nickname: { [Op.like]: `%${query}%` } },
          { username: { [Op.like]: `%${query}%` } },
          { publicUserId: { [Op.like]: `%${query}%` } },
          { phone: { [Op.like]: `%${query}%` } },
        ],
      },
    ];
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
      "avatar",
      "online",
      "accountStatus",
      "verified",
    ],
    order: [
      ["online", "DESC"],
      ["createdAt", "DESC"],
    ],
    limit: 30,
  });

  return users.map(serializeStarFriendsAdminUser);
};

export const getStarFriendsAdminConfig = async () => {
  const settings = await getAppSettings();
  const userIds = parseStarFriendsUserIds(settings.starFriendsUserIds);
  const users = (await loadStarFriendsUsers(userIds)).map(
    serializeStarFriendsAdminUser
  );

  return {
    enabled: Boolean(settings.starFriendsEnabled),
    audience:
      String(settings.starFriendsAudience || "new").toLowerCase() === "all"
        ? "all"
        : "new",
    callMode: parseStarFriendsCallMode(settings.starFriendsCallMode),
    userIds,
    users,
  };
};

export const getStarFriendsEligibility = async (userId) => {
  await ensureStarFriendsUserFlag();

  const settings = await getAppSettings();
  const userIds = parseStarFriendsUserIds(settings.starFriendsUserIds);
  const numericUserId = Number(userId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    return {
      enabled: Boolean(settings.starFriendsEnabled),
      eligible: false,
      reason: "invalid_user",
      seen: false,
      friends: [],
    };
  }

  const user = await User.findByPk(numericUserId, {
    attributes: [
      "id",
      "gender",
      "profileCompleted",
      "createdAt",
      "starFriendsPopupSeen",
    ],
  });

  const seen = Boolean(user?.starFriendsPopupSeen);
  const enabled = Boolean(settings.starFriendsEnabled);
  const audience =
    String(settings.starFriendsAudience || "new").toLowerCase() === "all"
      ? "all"
      : "new";
  const callMode = parseStarFriendsCallMode(settings.starFriendsCallMode);

  if (!user || String(user.gender || "").toLowerCase() !== "male") {
    return {
      enabled,
      eligible: false,
      reason: "not_male",
      seen,
      friends: [],
    };
  }

  if (!enabled) {
    return {
      enabled,
      eligible: false,
      reason: "disabled",
      seen: false,
      friends: [],
    };
  }

  if (audience !== "all" && !isNewMaleUser(user)) {
    return {
      enabled,
      eligible: false,
      reason: "not_new",
      seen,
      audience,
      friends: [],
    };
  }

  const friends = await getStarFriendsProfiles(userIds);

  if (friends.length < STAR_FRIENDS_COUNT) {
    return {
      enabled,
      eligible: false,
      reason: "incomplete_config",
      seen,
      friends: [],
    };
  }

  return {
    enabled,
    eligible: true,
    reason: null,
    seen: false,
    audience,
    callMode,
    friends,
  };
};

export const markStarFriendsSeen = async (userId) => {
  await ensureStarFriendsUserFlag();

  const numericUserId = Number(userId);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error("Valid user id is required");
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "gender", "starFriendsPopupSeen"],
  });

  if (!user || String(user.gender || "").toLowerCase() !== "male") {
    throw new Error("This popup is only for male users");
  }

  if (!user.starFriendsPopupSeen) {
    await user.update({ starFriendsPopupSeen: true });
  }

  return { seen: true };
};
