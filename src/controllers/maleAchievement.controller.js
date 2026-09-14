import {
  getMaleAchievements,
  updateWornMaleAchievementBadges,
} from "../services/maleAchievement.service.js";

export const getMaleAchievementsHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const data = await getMaleAchievements(userId);

    if (!data) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateWornMaleAchievementBadgesHandler = async (req, res) => {
  try {
    const { userId, badgeIds } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const result = await updateWornMaleAchievementBadges(userId, badgeIds);

    if (!result.valid) {
      return res.status(400).json({ message: result.message });
    }

    const data = await getMaleAchievements(userId);

    return res.json({
      message: "Worn badges updated",
      wornBadgeIds: result.wornBadgeIds,
      ...data,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
