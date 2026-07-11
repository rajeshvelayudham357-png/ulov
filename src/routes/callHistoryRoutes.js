import express from "express";


import {

saveCallHistory,

getCallHistory,
getFemaleCallHistory

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
    "/female/:userId",
    getFemaleCallHistory
    );


export default router;