import {
  claimMaleDailyBonus,
  getMaleDailyBonusEligibility,
} from "../services/maleDailyBonus.service.js";

export const getMaleDailyBonusEligibilityStatus = async (req, res) => {
  try {
    const authUserId = Number(req.user?.id);
    const requestedUserId = Number(req.params.userId);

    if (!Number.isFinite(authUserId)) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (!Number.isFinite(requestedUserId) || authUserId !== requestedUserId) {
      return res.status(403).json({
        message: "Forbidden",
      });
    }

    const eligibility = await getMaleDailyBonusEligibility(requestedUserId);
    return res.json(eligibility);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const claimMaleDailyBonusReward = async (req, res) => {
  try {
    const userId = Number(req.user?.id);

    if (!Number.isFinite(userId)) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await claimMaleDailyBonus(userId);
    return res.json(result);
  } catch (error) {
    const message = error.message || "Unable to claim daily bonus";
    const status =
      message.includes("already claimed") ||
      message.includes("disabled") ||
      message.includes("male users only") ||
      message.includes("new male users") ||
      message.includes("not configured")
        ? 400
        : 500;

    return res.status(status).json({
      message,
    });
  }
};
