import express from "express";


import {
 toggleFavorite,
 getFavorites,
 getFemaleFans
}
from "../controllers/favorite.controller.js";


const router =
express.Router();



router.post(
 "/toggle",
 toggleFavorite
);



router.get(
 "/fans/:femaleUserId",
 getFemaleFans
);



router.get(
 "/:userId",
 getFavorites
);



export default router;