import express from "express";
import { createVideoCall } from "../controllers/call.controller.js";
import {
    endCall
    }
    from "../controllers/callEnd.controller.js";
import {
getCallGifts,
sendCallGift
} from "../controllers/callGift.controller.js";
const router = express.Router();

router.post("/create", createVideoCall);
router.get("/gifts", getCallGifts);
router.post("/send-gift", sendCallGift);
router.post(
    "/end",
    endCall
    );
   
export default router;