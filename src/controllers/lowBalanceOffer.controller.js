import {
  getLowBalanceOfferEligibility,
  getLowBalanceOfferPublicConfig,
} from "../services/lowBalanceOffer.service.js";

export const getLowBalanceOfferConfig = async (req, res) => {
  try {
    const config = await getLowBalanceOfferPublicConfig();
    return res.json(config);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getLowBalanceOfferEligibilityStatus = async (req, res) => {
  try {
    const requestedUserId = Number(req.params.userId);
    const authUserId = Number(req.user?.id);

    if (!Number.isFinite(requestedUserId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (authUserId !== requestedUserId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const eligibility = await getLowBalanceOfferEligibility(requestedUserId);
    return res.json(eligibility);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
