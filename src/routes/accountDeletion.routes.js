import express from "express";

import {
  requestAccountDeletion,
  getAccountDeletionRequest,
} from "../controllers/accountDeletion.controller.js";

const router = express.Router();

router.post("/request", requestAccountDeletion);
router.get("/:userId", getAccountDeletionRequest);

export default router;
