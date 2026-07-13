import express from "express";

import {
requestWithdraw,
getWithdrawSummary,
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
"/summary/:userId",
getWithdrawSummary
);

router.get(
"/:userId",
withdrawHistory
);  

export default router;


