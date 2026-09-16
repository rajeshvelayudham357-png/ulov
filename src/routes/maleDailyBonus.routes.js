import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  claimMaleDailyBonusReward,
  getMaleDailyBonusEligibilityStatus,
} from "../controllers/maleDailyBonus.controller.js";

const router = express.Router();

router.get(
  "/eligibility/:userId",
  authMiddleware,
  getMaleDailyBonusEligibilityStatus
);
router.post("/claim", authMiddleware, claimMaleDailyBonusReward);

export default router;
