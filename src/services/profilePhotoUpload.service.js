import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROFILE_AVATAR_DIR = path.resolve(
  __dirname,
  "../../uploads/profile-avatars"
);

export const PROFILE_COVER_DIR = path.resolve(
  __dirname,
  "../../uploads/profile-covers"
);

export const ensureProfilePhotoUploadDirs = () => {
  [PROFILE_AVATAR_DIR, PROFILE_COVER_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

export const buildProfileAvatarUrl = (filename) =>
  `/uploads/profile-avatars/${filename}`;

export const buildProfileCoverUrl = (filename) =>
  `/uploads/profile-covers/${filename}`;
