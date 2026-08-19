import express from "express";


import {

saveCallHistory,

getCallHistory,
getFemaleCallHistory,
getFemaleMissedCalls,
getFemaleMissedCallSummary

}
from "../controllers/callHistoryController.js";



const router =
express.Router();



router.post(
"/end",
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