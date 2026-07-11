import express from "express";

import {
getFemaleDashboard
}
from "../controllers/female.controller.js";


const router =
express.Router();



router.get(
"/dashboard/:userId",
getFemaleDashboard
);



export default router;