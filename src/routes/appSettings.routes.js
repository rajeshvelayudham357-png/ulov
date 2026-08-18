import { Router } from "express";
import { getPublicAppSettings } from "../controllers/appSettings.controller.js";
import { getPublicAgoraConfigHandler } from "../controllers/agora.controller.js";

const router = Router();

router.get("/settings", getPublicAppSettings);
router.get("/agora-config", getPublicAgoraConfigHandler);

export default router;
