import express from "express";

import {
getNewsArticles,
getNewsCategories,
getNewsLanguages
} from "../controllers/news.controller.js";

const router =
express.Router();

router.get(
"/languages",
getNewsLanguages
);

router.get(
"/categories",
getNewsCategories
);

router.get(
"/",
getNewsArticles
);

export default router;
