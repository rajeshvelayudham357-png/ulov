import {
  claimFemaleScratchReward,
  getActiveScratchRewardForUser,
  getFemaleScratchRewardClaims,
  getMissedScratchRewardsForUser,
  listFemaleScratchRewards,
  listFemaleScratchRewardUsers,
  sendFemaleScratchReward,
} from "../services/femaleScratchReward.service.js";

const errorStatus = (message) => {
  if (
    String(message || "").includes("must be") ||
    String(message || "").includes("required") ||
    String(message || "").includes("Duration")
  ) {
    return 400;
  }

  if (String(message || "").includes("No matching")) {
    return 404;
  }

  if (String(message || "").includes("already claimed")) {
    return 409;
  }

  if (String(message || "").includes("expired")) {
    return 410;
  }

  if (String(message || "").includes("only for female")) {
    return 403;
  }

  if (String(message || "").includes("not found")) {
    return 404;
  }

  return 500;
};

export const listScratchRewardUsers = async (req, res) => {
  try {
    const users = await listFemaleScratchRewardUsers(req.query.search);
    return res.json(users);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const sendScratchReward = async (req, res) => {
  try {
    const {
      coins,
      durationSeconds,
      mode = "all",
      userIds,
      search,
    } = req.body || {};

    const reward = await sendFemaleScratchReward({
      coins,
      durationSeconds,
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

export const listScratchRewardHistory = async (req, res) => {
  try {
    const rows = await listFemaleScratchRewards();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const listScratchRewardClaims = async (req, res) => {
  try {
    const result = await getFemaleScratchRewardClaims(req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};

export const getActiveFemaleScratchReward = async (req, res) => {
  try {
    const reward = await getActiveScratchRewardForUser(req.params.userId);

    return res.json({
      reward,
    });
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};

export const claimActiveFemaleScratchReward = async (req, res) => {
  try {
    const result = await claimFemaleScratchReward(
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

export const getMissedFemaleScratchRewardSummary = async (req, res) => {
  try {
    const result = await getMissedScratchRewardsForUser(req.params.userId, {
      since: req.query.since,
    });

    return res.json({
      totalMissed: result.totalMissed,
    });
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};

export const listMissedFemaleScratchRewards = async (req, res) => {
  try {
    const result = await getMissedScratchRewardsForUser(req.params.userId);

    return res.json(result);
  } catch (error) {
    return res.status(errorStatus(error.message)).json({
      message: error.message,
    });
  }
};
