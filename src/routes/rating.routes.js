import express from "express";

import {
getFemaleCallRatings,
submitCallRating
} from "../controllers/rating.controller.js";

const router =
express.Router();

router.post(
"/submit",
submitCallRating
);

router.get(
"/female/:femaleUserId",
getFemaleCallRatings
);

export default router;
