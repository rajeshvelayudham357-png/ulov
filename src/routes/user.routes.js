import express from "express";

import {
  getProfile,
  getUsers,
  updateProfile,
  updateOnlineStatus,
  getUserById
} from "../controllers/user.controller.js";

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