import express from "express";

import {
  getProfile,
  getUsers,
  updateProfile,
  updateOnlineStatus,
  getUserById,
  uploadVerificationAudio,
  uploadVerificationVideo
} from "../controllers/user.controller.js";

import {
verificationAudioUpload
} from "../middleware/verificationAudioUpload.js";
import {
verificationVideoUpload
} from "../middleware/verificationVideoUpload.js";

import authMiddleware from "../middleware/authMiddleware.js";


const router = express.Router();


router.get(
  "/profile",
  getProfile
);


router.put(
  "/profile",
  updateProfile
);

router.post(
  "/verification-audio",
  verificationAudioUpload.single("audio"),
  uploadVerificationAudio
);

router.post(
  "/verification-video",
  verificationVideoUpload.single("video"),
  uploadVerificationVideo
);

router.get(
  "/",
  getUsers
 );

 router.put(
  "/status",
  updateOnlineStatus
  );

  router.get(
    "/:id",
    getUserById
    );


export default router;