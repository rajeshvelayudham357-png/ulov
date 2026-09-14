import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  acceptBattleInviteHandler,
  cancelBattleInviteHandler,
  createBattleInviteHandler,
  declineBattleInviteHandler,
  getBattleAgoraTokenHandler,
  getBattleFeatureStatusHandler,
  getBattleGiftsCatalogHandler,
  getBattleHandler,
  joinBattleAudienceHandler,
  joinBattleFighterHandler,
  leaveBattleAudienceHandler,
  listBattleInvitesHandler,
  listBattleOpponentsHandler,
  listLiveBattlesHandler,
  sendBattleGiftHandler,
} from "../controllers/battle.controller.js";

const router = express.Router();

router.get("/feature-status", getBattleFeatureStatusHandler);

router.post("/invites", authMiddleware, createBattleInviteHandler);
router.get("/invites", authMiddleware, listBattleInvitesHandler);
router.get("/opponents", authMiddleware, listBattleOpponentsHandler);
router.post(
  "/invites/:inviteId/accept",
  authMiddleware,
  acceptBattleInviteHandler
);
router.post(
  "/invites/:inviteId/decline",
  authMiddleware,
  declineBattleInviteHandler
);
router.post(
  "/invites/:inviteId/cancel",
  authMiddleware,
  cancelBattleInviteHandler
);

router.get("/", authMiddleware, listLiveBattlesHandler);
router.get("/gifts/catalog", authMiddleware, getBattleGiftsCatalogHandler);
router.get("/:battleId", authMiddleware, getBattleHandler);

router.post(
  "/:battleId/fighters/join",
  authMiddleware,
  joinBattleFighterHandler
);
router.post(
  "/:battleId/audience/join",
  authMiddleware,
  joinBattleAudienceHandler
);
router.post(
  "/:battleId/audience/leave",
  authMiddleware,
  leaveBattleAudienceHandler
);

router.post(
  "/:battleId/agora/token",
  authMiddleware,
  getBattleAgoraTokenHandler
);
router.post("/:battleId/gifts", authMiddleware, sendBattleGiftHandler);

export default router;
