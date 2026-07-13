import express from "express";

import {
getFemaleDashboard
}
from "../controllers/female.controller.js";

import {
claimFemaleTask,
getFemaleTasks,
pingFemaleTaskActivity
} from "../controllers/femaleTask.controller.js";

import {
endFemaleOnlineSession,
getFemaleOnlineTime,
pingFemaleOnlineTime,
startFemaleOnlineSession
} from "../controllers/femaleOnlineTime.controller.js";


const router =
express.Router();



router.get(
"/dashboard/:userId",
getFemaleDashboard
);

router.get(
"/tasks/:userId",
getFemaleTasks
);

router.post(
"/tasks/:userId/claim",
claimFemaleTask
);

router.post(
"/tasks/:userId/ping",
pingFemaleTaskActivity
);

router.get(
"/online-time/:userId",
getFemaleOnlineTime
);

router.post(
"/online-time/:userId/ping",
pingFemaleOnlineTime
);

router.post(
"/online-time/:userId/start",
startFemaleOnlineSession
);

router.post(
"/online-time/:userId/end",
endFemaleOnlineSession
);



export default router;
