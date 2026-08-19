import express from "express";
import { createVideoCall, getIncomingCallStatus, reportCallDeliveryEvent } from "../controllers/call.controller.js";
import authMiddleware from "../middleware/authMiddleware.js";
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
router.post(
  "/delivery-event",
  authMiddleware,
  reportCallDeliveryEvent
);
router.get(
  "/incoming-status",
  authMiddleware,
  getIncomingCallStatus
);
router.get("/gifts", getCallGifts);
router.post("/send-gift", sendCallGift);
router.post(
    "/end",
    endCall
    );
   
export default router;