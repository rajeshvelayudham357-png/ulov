import express from "express";


import {
getBroadcasts,
createBroadcast
}
from "../controllers/broadcast.controller.js";

import optionalAuthMiddleware from "../middleware/optionalAuthMiddleware.js";


const router =
express.Router();


router.get(
"/",
optionalAuthMiddleware,
getBroadcasts
);


router.post(
"/",
createBroadcast
);


export default router;