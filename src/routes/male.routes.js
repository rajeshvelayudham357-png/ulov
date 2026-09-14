import express from "express";

import {
  getActiveMaleScratchReward,
  claimActiveMaleScratchReward,
  getMissedMaleScratchRewardSummary,
  listMissedMaleScratchRewards,
} from "../controllers/maleScratchReward.controller.js";

const router = express.Router();

router.get(
  "/scratch-reward/:userId/missed/summary",
  getMissedMaleScratchRewardSummary
);

router.get(
  "/scratch-reward/:userId/missed",
  listMissedMaleScratchRewards
);

router.get(
  "/scratch-reward/:userId/active",
  getActiveMaleScratchReward
);

router.post(
  "/scratch-reward/:userId/claim",
  claimActiveMaleScratchReward
);

export default router;
