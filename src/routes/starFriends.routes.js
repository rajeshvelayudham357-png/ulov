import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  dismissStarFriendsPopup,
  getStarFriendsEligibilityStatus,
} from "../controllers/starFriends.controller.js";

const router = express.Router();

router.get(
  "/eligibility/:userId",
  authMiddleware,
  getStarFriendsEligibilityStatus
);
router.post("/dismiss", authMiddleware, dismissStarFriendsPopup);

export default router;
