import express from "express";

import {
getEarnings
}
from "../controllers/earning.controller.js";


const router =
express.Router();



router.get(
"/:userId",
getEarnings
);



export default router;