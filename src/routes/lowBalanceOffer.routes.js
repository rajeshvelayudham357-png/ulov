import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  getLowBalanceOfferConfig,
  getLowBalanceOfferEligibilityStatus,
} from "../controllers/lowBalanceOffer.controller.js";

const router = express.Router();

router.get("/config", getLowBalanceOfferConfig);
router.get(
  "/eligibility/:userId",
  authMiddleware,
  getLowBalanceOfferEligibilityStatus
);

export default router;
