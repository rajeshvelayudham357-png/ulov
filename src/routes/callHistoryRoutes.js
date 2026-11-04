import express from "express";


import {

saveCallHistory,

getCallHistory,
getFemaleCallHistory,
getFemaleMissedCalls,
getFemaleMissedCallSummary

}
from "../controllers/callHistoryController.js";
import authMiddleware from "../middleware/authMiddleware.js";



const router =
express.Router();



router.post(
"/end",
authMiddleware,
saveCallHistory
);



router.get(
"/:userId",
getCallHistory
);

router.get(
"/female/:userId/missed/summary",
getFemaleMissedCallSummary
);

router.get(
"/female/:userId/missed",
getFemaleMissedCalls
);

router.get(
    "/female/:userId",
    getFemaleCallHistory
    );


export default router;