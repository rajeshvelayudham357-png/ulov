import express from "express";

import {
registerToken,
syncFavorites,
favoriteOnline,
broadcastNotification,
getNotifications,
markNotificationsRead
} from "../controllers/notification.controller.js";

const router =
express.Router();

router.post(
"/register-token",
registerToken
);

router.post(
"/favorites",
syncFavorites
);

router.post(
"/favorite-online",
favoriteOnline
);

router.post(
"/broadcast",
broadcastNotification
);

router.get(
"/:userId",
getNotifications
);

router.put(
"/:userId/read",
markNotificationsRead
);

export default router;
