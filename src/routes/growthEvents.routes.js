import express from "express";

import { trackPublicGrowthEvent } from "../controllers/growthEvents.controller.js";

const router = express.Router();

router.post("/track", trackPublicGrowthEvent);

export default router;
