import express from "express";


import {

getWallet,

rechargeWallet,

spendWallet,
getWalletTransactions

}
from "../controllers/wallet.controller.js";



const router =
express.Router();



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
spendWallet
);

router.get(
    "/transactions/:userId",
    getWalletTransactions
    );


export default router;