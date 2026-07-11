import express from "express";

import {
blockUser,
getBlockedUsers,
unblockUser
} from "../controllers/block.controller.js";

const router =
express.Router();

router.post(
"/",
blockUser
);

router.get(
"/:userId",
getBlockedUsers
);

router.delete(
"/:blockedUserId",
unblockUser
);

export default router;
