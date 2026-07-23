import express from "express";

import {
  sendOtp,
  verifyOtp,
  getAuthConfig,
  checkPinPhone,
  setLoginPin,
  verifyLoginPin,
  registerFemaleCreator,
  completeFemaleCreatorVerification,
} from "../controllers/authController.js";

const router = express.Router();

router.get("/config", getAuthConfig);

router.post("/send-otp", sendOtp);

router.post("/verify-otp", verifyOtp);

router.post("/female-registration", registerFemaleCreator);

router.post("/female-registration/verification-complete", completeFemaleCreatorVerification);

router.post("/pin/check-phone", checkPinPhone);

router.post("/pin/set", setLoginPin);

router.post("/pin/verify", verifyLoginPin);

export default router;
