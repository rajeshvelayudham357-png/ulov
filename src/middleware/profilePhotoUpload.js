import multer from "multer";
import path from "path";

import {
  ensureProfilePhotoUploadDirs,
  PROFILE_AVATAR_DIR,
  PROFILE_COVER_DIR,
} from "../services/profilePhotoUpload.service.js";

ensureProfilePhotoUploadDirs();

const allowedMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/octet-stream",
  "",
];

const createStorage = (destinationDir, prefix) =>
  multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureProfilePhotoUploadDirs();
      cb(null, destinationDir);
    },
    filename: (req, file, cb) => {
      const userId = req.body?.userId || "unknown";
      const ext =
        path.extname(file.originalname)?.toLowerCase() ||
        (String(file.mimetype || "").includes("png") ? ".png" : ".jpg");

      cb(null, `${prefix}-${userId}-${Date.now()}${ext}`);
    },
  });

const createUpload = (destinationDir, prefix) =>
  multer({
    storage: createStorage(destinationDir, prefix),
    limits: {
      fileSize: 8 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      const mime = String(file.mimetype || "").toLowerCase();
      const original = String(file.originalname || "");

      if (
        mime.startsWith("image/") ||
        allowedMimeTypes.includes(mime) ||
        original.match(/\.(jpe?g|png|webp|heic|heif)$/i)
      ) {
        cb(null, true);
        return;
      }

      cb(new Error("Only image files are allowed"));
    },
  });

export const profileAvatarUpload = createUpload(
  PROFILE_AVATAR_DIR,
  "profile-avatar"
);

export const profileCoverUpload = createUpload(
  PROFILE_COVER_DIR,
  "profile-cover"
);
