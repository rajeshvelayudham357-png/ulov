import express from "express";


import {

getWallet,

rechargeWallet,

spendWallet,
getWalletTransactions,
getRechargeHistory

}
from "../controllers/wallet.controller.js";
import authMiddleware from "../middleware/authMiddleware.js";



const router =
express.Router();



router.get(
"/recharges/:userId",
getRechargeHistory
);



router.get(
"/:userId",
getWallet
);



router.post(
"/recharge",
rechargeWallet
);



router.post(
"/spend",
authMiddleware,
spendWallet
);

router.get(
    "/transactions/:userId",
    getWalletTransactions
    );


export default router;