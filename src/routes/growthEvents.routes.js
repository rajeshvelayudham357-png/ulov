import express from "express";

import { trackPublicGrowthEvent } from "../controllers/growthEvents.controller.js";
import { growthEventsRateLimit } from "../middleware/growthEventsRateLimit.middleware.js";

const router = express.Router();

router.post(
  "/track",
  growthEventsRateLimit,
  express.json({ limit: "16kb" }),
  trackPublicGrowthEvent
);

export default router;
