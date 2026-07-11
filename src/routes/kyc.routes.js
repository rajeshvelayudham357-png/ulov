import express from "express";

import {
saveKyc,
getKyc
}
from "../controllers/kyc.controller.js";


const router =
express.Router();


router.post(
"/save",
saveKyc
);


router.get(
"/:userId",
getKyc
);


export default router;