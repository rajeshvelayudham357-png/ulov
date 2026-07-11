import express from "express";
import { createVideoCall } from "../controllers/call.controller.js";
import {
    endCall
    }
    from "../controllers/callEnd.controller.js";
const router = express.Router();

router.post("/create", createVideoCall);
router.post(
    "/end",
    endCall
    );
   
export default router;