import express from "express";

import { requireAdmin } from "../controllers/admin.controller.js";
import {
  listAccountDeletionRequests,
  approveAccountDeletionRequest,
  rejectAccountDeletionRequest,
} from "../controllers/accountDeletion.controller.js";

const router = express.Router();

router.use(requireAdmin);

router.get("/", listAccountDeletionRequests);
router.patch("/:id/approve", approveAccountDeletionRequest);
router.patch("/:id/reject", rejectAccountDeletionRequest);

export default router;
