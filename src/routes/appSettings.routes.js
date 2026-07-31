import { Router } from "express";
import { getPublicAppSettings } from "../controllers/appSettings.controller.js";

const router = Router();

router.get("/settings", getPublicAppSettings);

export default router;
