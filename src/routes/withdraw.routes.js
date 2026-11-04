import express from "express";

import {
requestWithdraw,
getWithdrawAvailabilityStatus,
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

// Must stay above "/:userId".
router.get(
"/availability",
getWithdrawAvailabilityStatus
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
