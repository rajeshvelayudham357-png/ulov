import express from "express";


import {

getPayouts,

approvePayout,

rejectPayout

}

from "../controllers/payout.controller.js";





const router =
express.Router();





router.get(

"/",

getPayouts

);




router.patch(

"/:id/approve",

approvePayout

);




router.patch(

"/:id/reject",

rejectPayout

);




export default router;