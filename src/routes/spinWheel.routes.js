import express from "express";

import {
  getSpinWheelStatus,
  getSpinWheelConfig,
  spinWheelPlay,
} from "../controllers/spinWheel.controller.js";

const router = express.Router();

router.get("/config", getSpinWheelConfig);
router.get("/status/:userId", getSpinWheelStatus);
router.post("/spin", spinWheelPlay);

export default router;
