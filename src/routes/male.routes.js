import express from "express";

import {
  getActiveMaleScratchReward,
  claimActiveMaleScratchReward,
  getMissedMaleScratchRewardSummary,
  listMissedMaleScratchRewards,
} from "../controllers/maleScratchReward.controller.js";
import {
  claimMaleTask,
  getMaleTasks,
  getMaleTasksHistory,
  getMaleTasksSummary,
} from "../controllers/maleTask.controller.js";

const router = express.Router();

router.get("/tasks/:userId", getMaleTasks);
router.get("/tasks/:userId/summary", getMaleTasksSummary);
router.get("/tasks/:userId/history", getMaleTasksHistory);
router.post("/tasks/:userId/claim", claimMaleTask);

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
