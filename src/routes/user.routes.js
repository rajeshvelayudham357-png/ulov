import express from "express";

import {
  getProfile,
  getUsers,
  updateProfile,
  updateOnlineStatus,
  updateCallPreferences,
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

const handleVerificationVideoUpload =
(req, res, next) => {
  verificationVideoUpload.single("video")(req, res, (error) => {
    if (!error) {
      return next();
    }

    console.log("VERIFICATION VIDEO MULTER ERROR", error);

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: "Video is too large. Please record a shorter clip.",
      });
    }

    return res.status(400).json({
      message: error.message || "Video upload failed",
    });
  });
};

router.post(
  "/verification-video",
  handleVerificationVideoUpload,
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

 router.put(
  "/call-preferences",
  updateCallPreferences
 );

  router.get(
    "/:id",
    getUserById
    );


export default router;