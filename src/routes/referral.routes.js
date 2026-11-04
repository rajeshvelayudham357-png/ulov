import express from "express";

import {
  applyMyReferralCode,
  getMyReferralOverview,
  getMyReferralStatus,
} from "../controllers/referral.controller.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Creator: her code, rewards and the people she referred.
router.get("/me", authMiddleware, getMyReferralOverview);

// Male: whether he can still enter a code, and applying one.
router.get("/status", authMiddleware, getMyReferralStatus);
router.post("/apply", authMiddleware, applyMyReferralCode);

export default router;
