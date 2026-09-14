import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  closeVoiceRoomHandler,
  createVoiceRoomHandler,
  getVoiceRoomFeatureStatusHandler,
  getVoiceRoomHandler,
  getVoiceRoomAgoraTokenHandler,
  getVoiceRoomChatHandler,
  getVoiceRoomGiftsCatalogHandler,
  joinVoiceRoomSeatHandler,
  leaveVoiceRoomSeatHandler,
  leaveVoiceRoomHandler,
  listLiveVoiceRoomsHandler,
  sendVoiceRoomChatHandler,
  sendVoiceRoomGiftHandler,
  startVoiceRoomHandler,
} from "../controllers/voiceRoom.controller.js";

const router = express.Router();

router.get("/feature-status", getVoiceRoomFeatureStatusHandler);

router.post("/", authMiddleware, createVoiceRoomHandler);
router.get("/", authMiddleware, listLiveVoiceRoomsHandler);
router.get("/gifts/catalog", authMiddleware, getVoiceRoomGiftsCatalogHandler);
router.get("/:roomId", authMiddleware, getVoiceRoomHandler);
router.post("/:roomId/start", authMiddleware, startVoiceRoomHandler);
router.post("/:roomId/close", authMiddleware, closeVoiceRoomHandler);
router.post("/:roomId/leave", authMiddleware, leaveVoiceRoomHandler);
router.post(
  "/:roomId/agora/token",
  authMiddleware,
  getVoiceRoomAgoraTokenHandler
);
router.post(
  "/:roomId/seats/:seatIndex/join",
  authMiddleware,
  joinVoiceRoomSeatHandler
);
router.post(
  "/:roomId/seats/:seatIndex/leave",
  authMiddleware,
  leaveVoiceRoomSeatHandler
);
router.get("/:roomId/chat", authMiddleware, getVoiceRoomChatHandler);
router.post("/:roomId/chat", authMiddleware, sendVoiceRoomChatHandler);
router.post("/:roomId/gifts", authMiddleware, sendVoiceRoomGiftHandler);

export default router;
