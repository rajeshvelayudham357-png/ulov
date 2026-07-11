import express from "express";

import {
getConversation,
getConversations,
sendMessage
} from "../controllers/chat.controller.js";

const router =
express.Router();

router.post(
"/send",
sendMessage
);

router.get(
"/conversations/:userId",
getConversations
);

router.get(
"/:userId/:peerId",
getConversation
);

export default router;
