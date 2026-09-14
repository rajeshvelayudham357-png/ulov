import { getAppSettings } from "./appSettings.service.js";
import {
  DEFAULT_PROFILE_ANIMATIONS,
  getEnabledProfileAnimation,
  normalizeProfileAnimationId,
} from "../constants/profileAnimations.js";

export const getProfileAnimationsCatalog = async () => {
  const settings = await getAppSettings();
  return settings.profileAnimationsCatalog ?? [];
};

export const validateProfileAnimationSelection = async (animationId) => {
  const normalizedId = normalizeProfileAnimationId(animationId);

  if (!normalizedId) {
    return { valid: true, profileAnimationId: null };
  }

  const catalog = await getProfileAnimationsCatalog();
  let match = getEnabledProfileAnimation(catalog, normalizedId);

  if (!match) {
    match = getEnabledProfileAnimation(
      DEFAULT_PROFILE_ANIMATIONS,
      normalizedId
    );
  }

  if (!match) {
    return {
      valid: false,
      message: "Selected profile animation is not available",
    };
  }

  return {
    valid: true,
    profileAnimationId: match.id,
  };
};
