import {
  getFemaleAchievements,
  updateWornAchievementBadges,
} from "../services/femaleAchievement.service.js";

export const getFemaleAchievementsHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const data = await getFemaleAchievements(userId);

    if (!data) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateWornAchievementBadgesHandler = async (req, res) => {
  try {
    const { userId, badgeIds } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const result = await updateWornAchievementBadges(userId, badgeIds);

    if (!result.valid) {
      return res.status(400).json({ message: result.message });
    }

    const data = await getFemaleAchievements(userId);

    return res.json({
      message: "Worn badges updated",
      wornBadgeIds: result.wornBadgeIds,
      ...data,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
