import {
  getStarFriendsAdminConfig,
  getStarFriendsEligibility,
  markStarFriendsSeen,
  searchStarFriendsCandidates,
} from "../services/starFriends.service.js";

export const getStarFriendsAdmin = async (_req, res) => {
  try {
    const result = await getStarFriendsAdminConfig();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const searchStarFriendsAdminUsers = async (req, res) => {
  try {
    const users = await searchStarFriendsCandidates(req.query.search);
    return res.json(users);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getStarFriendsEligibilityStatus = async (req, res) => {
  try {
    const result = await getStarFriendsEligibility(req.params.userId);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const dismissStarFriendsPopup = async (req, res) => {
  try {
    const result = await markStarFriendsSeen(req.user?.id || req.body?.userId);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};
