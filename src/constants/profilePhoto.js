export const PROFILE_PHOTO_UPLOAD_MIN_LEVEL = 3;
export const PROFILE_PHOTO_UNLOCK_COINS = 10_000;

export const isProfilePhotoUploadAllowed = (user, userLevel) => {
  if (Boolean(user?.profilePhotoUnlocked)) {
    return true;
  }

  return Number(userLevel?.level ?? 0) >= PROFILE_PHOTO_UPLOAD_MIN_LEVEL;
};
