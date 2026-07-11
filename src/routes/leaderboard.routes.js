import express from "express";

import {
leaderboard
}
from "../controllers/leaderboard.controller.js";


const router =
express.Router();



router.get(
"/",
leaderboard
);



export default router;