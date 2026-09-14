import express from "express";

import {
  getProfile,
  getUsers,
  updateProfile,
  updateOnlineStatus,
  updateCallPreferences,
  updateNotificationPreferences,
  updateProfileAnimation,
  updateEntryEffect,
  getEntryEffectsCatalog,
  purchaseEntryEffect,
  verifyPhoneNumber,
  getUserById,
  uploadVerificationAudio,
  uploadVerificationVideo,
  uploadProfileAvatar,
  uploadProfileCoverPhoto,
  purchaseProfilePhotoUnlock,
} from "../controllers/user.controller.js";

import {
  getMaleAchievementsHandler,
  updateWornMaleAchievementBadgesHandler,
} from "../controllers/maleAchievement.controller.js";

import {
verificationAudioUpload
} from "../middleware/verificationAudioUpload.js";
import {
verificationVideoUpload
} from "../middleware/verificationVideoUpload.js";
import {
profileAvatarUpload,
profileCoverUpload
} from "../middleware/profilePhotoUpload.js";

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

const handleProfilePhotoUpload =
(uploadMiddleware, fieldName) =>
(req, res, next) => {
  uploadMiddleware.single(fieldName)(req, res, (error) => {
    if (!error) {
      return next();
    }

    console.log("PROFILE PHOTO MULTER ERROR", error);

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: "Photo is too large. Please choose a smaller image.",
      });
    }

    return res.status(400).json({
      message: error.message || "Photo upload failed",
    });
  });
};

router.post(
  "/profile-avatar",
  handleProfilePhotoUpload(profileAvatarUpload, "photo"),
  uploadProfileAvatar
);

router.post(
  "/profile-cover",
  handleProfilePhotoUpload(profileCoverUpload, "photo"),
  uploadProfileCoverPhoto
);

router.post(
  "/profile-photo-unlock",
  authMiddleware,
  purchaseProfilePhotoUnlock
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

 router.put(
  "/notification-preferences",
  updateNotificationPreferences
 );

 router.put(
  "/profile-animation",
  authMiddleware,
  updateProfileAnimation
 );

 router.put(
  "/entry-effect",
  authMiddleware,
  updateEntryEffect
 );

 router.get(
  "/entry-effects",
  authMiddleware,
  getEntryEffectsCatalog
 );

 router.post(
  "/entry-effects/purchase",
  authMiddleware,
  purchaseEntryEffect
 );

 router.post(
  "/phone/verify",
  verifyPhoneNumber
 );

router.get(
  "/achievements/:userId",
  getMaleAchievementsHandler
);

router.put(
  "/achievements/wear",
  updateWornMaleAchievementBadgesHandler
);

  router.get(
    "/:id",
    getUserById
    );


export default router;