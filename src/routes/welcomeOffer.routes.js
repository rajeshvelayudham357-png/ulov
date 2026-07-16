import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  claimWelcomeOfferBonus,
  getWelcomeOfferConfig,
  getWelcomeOfferEligibilityStatus,
} from "../controllers/welcomeOffer.controller.js";

const router = express.Router();

router.get("/config", getWelcomeOfferConfig);
router.get(
  "/eligibility/:userId",
  authMiddleware,
  getWelcomeOfferEligibilityStatus
);
router.post("/claim", authMiddleware, claimWelcomeOfferBonus);

export default router;
