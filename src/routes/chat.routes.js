import express from "express";

import {
getConversation,
getConversations,
getPeerPresence,
sendMessage
} from "../controllers/chat.controller.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router =
express.Router();

router.post(
"/send",
authMiddleware,
sendMessage
);

router.get(
"/conversations/:userId",
getConversations
);

router.get(
"/presence/:peerId",
authMiddleware,
getPeerPresence
);

router.get(
"/:userId/:peerId",
getConversation
);

export default router;
