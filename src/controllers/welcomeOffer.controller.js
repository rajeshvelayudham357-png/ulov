import {
  claimWelcomeOffer,
  getWelcomeOfferEligibility,
  getWelcomeOfferPublicConfig,
} from "../services/welcomeOffer.service.js";

export const getWelcomeOfferConfig = async (req, res) => {
  try {
    const config = await getWelcomeOfferPublicConfig();

    return res.json(config);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getWelcomeOfferEligibilityStatus = async (req, res) => {
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

    const eligibility = await getWelcomeOfferEligibility(requestedUserId);

    return res.json(eligibility);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const claimWelcomeOfferBonus = async (req, res) => {
  try {
    const userId = Number(req.user?.id);

    if (!Number.isFinite(userId)) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await claimWelcomeOffer(userId);

    return res.json(result);
  } catch (error) {
    const message = error.message || "Unable to claim welcome offer";
    const status =
      message.includes("already claimed") ||
      message.includes("disabled") ||
      message.includes("male users only") ||
      message.includes("Complete your profile")
        ? 400
        : 500;

    return res.status(status).json({
      message,
    });
  }
};
