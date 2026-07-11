import express from "express";


import {
getBroadcasts,
createBroadcast
}
from "../controllers/broadcast.controller.js";


const router =
express.Router();


router.get(
"/",
getBroadcasts
);


router.post(
"/",
createBroadcast
);


export default router;