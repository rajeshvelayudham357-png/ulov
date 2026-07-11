import express from "express";

import {

requestWithdraw,
withdrawHistory

}
from "../controllers/withdraw.controller.js";

 const router =
express.Router();



router.post(
"/request",
requestWithdraw
);


router.get(
"/:userId",
withdrawHistory
);  

export default router;


