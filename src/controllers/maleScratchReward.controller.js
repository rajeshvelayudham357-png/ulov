import {
  claimMaleScratchReward,
  getActiveScratchRewardForUser,
  getMaleScratchRewardClaims,
  getMissedScratchRewardsForUser,
  listMaleScratchPackages,
  listMaleScratchRewards,
  listMaleScratchRewardUsers,
  sendMaleScratchReward,
} from "../services/maleScratchReward.service.js";

const errorStatus = (message) => {
  const text = String(message || "");

  if (
    text.includes("must be") ||
    text.includes("required") ||
    text.includes("Duration") ||
    text.includes("Select a recharge")
  ) {
    return 400;
  }

  if (text.includes("No matching")) {
    return 404;
  }

  if (text.includes("already claimed")) {
    return 409;
  }

  if (text.includes("expired")) {
    return 410;
  }

  if (text.includes("only for male")) {
    return 403;
  }

  if (text.includes("not found")) {
    return 404;
  }

  return 500;
};

export const listScratchRewardPackages = async (_req, res) => {
  try {
    const packages = await listMaleScratchPackages();
    return res.json(packages);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listScratchRewardUsers = async (req, res) => {
  try {
    const users = await listMaleScratchRewardUsers(req.query.search);
    return res.json(users);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const sendScratchReward = async (req, res) => {
  try {
    const {
      coins,
      durationSeconds,
      packageId,
      mode = "all",
      userIds,
      search,
    } = req.body || {};

    const reward = await sendMaleScratchReward({
      coins,
      durationSeconds,
      packageId,
      mode,
      userIds,
      search,
      adminId: req.admin?.id || null,
    });

    return res.json({
      message: "Scratch reward sent",
      reward,
    });
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};

export const listScratchRewardHistory = async (_req, res) => {
  try {
    const rows = await listMaleScratchRewards();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listScratchRewardClaims = async (req, res) => {
  try {
    const result = await getMaleScratchRewardClaims(req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};

export const getActiveMaleScratchReward = async (req, res) => {
  try {
    const reward = await getActiveScratchRewardForUser(req.params.userId);
    return res.json({ reward });
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};

export const claimActiveMaleScratchReward = async (req, res) => {
  try {
    const result = await claimMaleScratchReward(
      req.params.userId,
      req.body?.rewardId
    );
    return res.json(result);
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};

export const getMissedMaleScratchRewardSummary = async (req, res) => {
  try {
    const result = await getMissedScratchRewardsForUser(req.params.userId, {
      since: req.query.since,
    });
    return res.json({ totalMissed: result.totalMissed });
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};

export const listMissedMaleScratchRewards = async (req, res) => {
  try {
    const result = await getMissedScratchRewardsForUser(req.params.userId);
    return res.json(result);
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};
