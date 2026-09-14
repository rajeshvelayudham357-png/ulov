import { QueryTypes } from "sequelize";

import {
  MAX_WORN_ACHIEVEMENT_BADGES,
  resolveFemaleAchievementLevel,
} from "../constants/femaleAchievements.js";
import { CallGiftRecord, CallHistory, Earning, User } from "../models/index.js";
import { attachUserLevel } from "./userLevel.service.js";
import { ensureFemaleAchievementSchema } from "./femaleAchievementSchema.service.js";
import { getFemaleOnlineTimeStats } from "./femaleOnlineTime.service.js";
import { sequelize } from "../config/database.js";

const parseWornBadgeIds = (raw) => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, MAX_WORN_ACHIEVEMENT_BADGES);
  } catch {
    return [];
  }
};

const loadBadgeCatalog = async () => {
  const rows = await sequelize.query(
    `SELECT id, title, category, previewEmoji, iconKey, description, points,
            requirementType, requirementValue, sortOrder
     FROM female_achievement_badges
     WHERE enabled = 1
     ORDER BY sortOrder ASC, title ASC`,
    { type: QueryTypes.SELECT }
  );

  return rows;
};

const loadFemaleStats = async (userId) => {
  const [goldRaw, minutesRaw, calls, gifts, tasksClaimed, onlineStats, user] =
    await Promise.all([
      Earning.sum("amount", { where: { userId } }),
      Earning.sum("duration", { where: { userId } }),
      CallHistory.count({ where: { receiverId: userId } }),
      CallGiftRecord.count({ where: { receiverId: userId } }),
      sequelize
        .query(
          `SELECT COUNT(*) AS total
         FROM female_task_claims
         WHERE userId = :userId`,
          {
            replacements: { userId },
            type: QueryTypes.SELECT,
          }
        )
        .catch(() => [{ total: 0 }]),
      getFemaleOnlineTimeStats(userId).catch(() => ({
        totalOnlineMinutes: 0,
      })),
      User.findByPk(userId, {
        attributes: [
          "id",
          "username",
          "name",
          "avatar",
          "verified",
          "wornAchievementBadgeIds",
        ],
      }),
    ]);

  const userLevel = user ? await attachUserLevel(user) : null;

  return {
    user,
    userLevel,
    stats: {
      gold: Number(goldRaw) || 0,
      minutes: Number(minutesRaw) || 0,
      calls: Number(calls) || 0,
      gifts: Number(gifts) || 0,
      tasks: Number(tasksClaimed?.[0]?.total) || 0,
      onlineMinutes: Number(onlineStats?.totalOnlineMinutes) || 0,
      level: Number(userLevel?.level) || 0,
      verified: Boolean(user?.verified),
    },
  };
};

const isBadgeUnlocked = (badge, stats) => {
  const required = Number(badge.requirementValue) || 0;

  switch (String(badge.requirementType)) {
    case "calls":
      return stats.calls >= required;
    case "minutes":
      return stats.minutes >= required;
    case "gold":
      return stats.gold >= required;
    case "gifts":
      return stats.gifts >= required;
    case "tasks":
      return stats.tasks >= required;
    case "online_minutes":
      return stats.onlineMinutes >= required;
    case "level":
      return stats.level >= required;
    case "verified":
      return stats.verified;
    default:
      return false;
  }
};

const mapBadgeWithProgress = (badge, stats) => {
  const unlocked = isBadgeUnlocked(badge, stats);
  let currentValue = 0;

  switch (String(badge.requirementType)) {
    case "calls":
      currentValue = stats.calls;
      break;
    case "minutes":
      currentValue = stats.minutes;
      break;
    case "gold":
      currentValue = stats.gold;
      break;
    case "gifts":
      currentValue = stats.gifts;
      break;
    case "tasks":
      currentValue = stats.tasks;
      break;
    case "online_minutes":
      currentValue = stats.onlineMinutes;
      break;
    case "level":
      currentValue = stats.level;
      break;
    case "verified":
      currentValue = stats.verified ? 1 : 0;
      break;
    default:
      currentValue = 0;
  }

  const targetValue = Math.max(1, Math.floor(Number(badge.requirementValue) || 1));
  currentValue = Math.max(0, Math.floor(Number(currentValue) || 0));
  const progressPercentage = unlocked
    ? 100
    : Math.max(
        0,
        Math.min(100, Math.round((currentValue / targetValue) * 100))
      );

  return {
    id: badge.id,
    title: badge.title,
    category: badge.category,
    previewEmoji: badge.previewEmoji || "🏅",
    iconKey: badge.iconKey || "medal",
    description: badge.description || "",
    points: Math.max(0, Math.floor(Number(badge.points) || 0)),
    requirementType: badge.requirementType,
    requirementValue: targetValue,
    currentValue,
    progressPercentage,
    unlocked,
  };
};

export const getFemaleAchievements = async (userId) => {
  await ensureFemaleAchievementSchema();

  const [catalog, payload] = await Promise.all([
    loadBadgeCatalog(),
    loadFemaleStats(userId),
  ]);

  if (!payload.user) {
    return null;
  }

  const badges = catalog.map((badge) =>
    mapBadgeWithProgress(badge, payload.stats)
  );

  const unlockedBadges = badges.filter((badge) => badge.unlocked);
  const achievementPoints = unlockedBadges.reduce(
    (sum, badge) => sum + badge.points,
    0
  );

  const wornBadgeIds = parseWornBadgeIds(
    payload.user.wornAchievementBadgeIds
  ).filter((id) => unlockedBadges.some((badge) => badge.id === id));

  const wornBadges = wornBadgeIds
    .map((id) => unlockedBadges.find((badge) => badge.id === id))
    .filter(Boolean);

  const displayName =
    payload.user.username?.trim() ||
    payload.user.name?.trim() ||
    "Creator";

  const achievementLevel = resolveFemaleAchievementLevel(achievementPoints);

  return {
    user: {
      id: payload.user.id,
      displayName,
      avatar: payload.user.avatar,
    },
    achievementPoints,
    achievementLevel,
    wornBadgeIds,
    wornBadges,
    stats: payload.stats,
    badges,
    summary: {
      total: badges.length,
      unlocked: unlockedBadges.length,
      achievement: badges.filter((b) => b.category === "achievement").length,
      honor: badges.filter((b) => b.category === "honor").length,
      activity: badges.filter((b) => b.category === "activity").length,
      premium: badges.filter((b) => b.category === "premium").length,
    },
  };
};

export const updateWornAchievementBadges = async (userId, badgeIds = []) => {
  await ensureFemaleAchievementSchema();

  const user = await User.findByPk(userId);

  if (!user) {
    return { valid: false, message: "User not found" };
  }

  const achievements = await getFemaleAchievements(userId);

  if (!achievements) {
    return { valid: false, message: "User not found" };
  }

  const normalizedIds = Array.isArray(badgeIds)
    ? badgeIds
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .slice(0, MAX_WORN_ACHIEVEMENT_BADGES)
    : [];

  const unlockedIds = new Set(
    achievements.badges
      .filter((badge) => badge.unlocked)
      .map((badge) => badge.id)
  );

  for (const badgeId of normalizedIds) {
    if (!unlockedIds.has(badgeId)) {
      return {
        valid: false,
        message: "You can only wear badges you have unlocked",
      };
    }
  }

  await user.update({
    wornAchievementBadgeIds: normalizedIds.length ? normalizedIds : null,
  });

  return {
    valid: true,
    wornBadgeIds: normalizedIds,
  };
};
