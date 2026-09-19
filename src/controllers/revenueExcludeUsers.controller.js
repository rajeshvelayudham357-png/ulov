import {
  getRevenueExcludeUsers,
  searchRevenueExcludeCandidates,
  setRevenueExcludeUserIds,
} from "../services/revenueExcludeUsers.service.js";

export const getRevenueExcludeUsersConfig = async (_req, res) => {
  try {
    return res.json(await getRevenueExcludeUsers());
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const searchRevenueExcludeUsers = async (req, res) => {
  try {
    const users = await searchRevenueExcludeCandidates(
      req.query.search || req.query.q || ""
    );
    return res.json(users);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateRevenueExcludeUsersConfig = async (req, res) => {
  try {
    return res.json(
      await setRevenueExcludeUserIds(req.body?.userIds ?? req.body?.users ?? [])
    );
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};
