import express from "express";

import {
getFemaleDashboard,
getMaleRankers,
getMaleProfileForFemale
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

import {
getFemaleReceivedGifts
} from "../controllers/callGift.controller.js";

import {
  getFemaleAchievementsHandler,
  updateWornAchievementBadgesHandler,
} from "../controllers/femaleAchievement.controller.js";


const router =
express.Router();



router.get(
"/dashboard/:userId",
getFemaleDashboard
);

router.get(
"/male-rankers/:userId",
getMaleRankers
);

router.get(
"/male-profile/:maleId",
getMaleProfileForFemale
);

router.get(
"/gifts/:userId",
getFemaleReceivedGifts
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

router.get(
  "/achievements/:userId",
  getFemaleAchievementsHandler
);

router.put(
  "/achievements/wear",
  updateWornAchievementBadgesHandler
);

export default router;
