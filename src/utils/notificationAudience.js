export const MALE_ONLY_NOTIFICATION_TYPES = new Set([
  "favorite_online",
]);

export const FEMALE_ONLY_NOTIFICATION_TYPES = new Set([
  "kyc_approved",
  "account_approved",
  "broadcast",
]);

export const isNotificationVisibleForGender = (type, gender) => {
  const normalizedGender = String(gender ?? "").trim().toLowerCase();
  const normalizedType = String(type ?? "system").trim().toLowerCase();

  if (MALE_ONLY_NOTIFICATION_TYPES.has(normalizedType)) {
    return normalizedGender === "male";
  }

  if (FEMALE_ONLY_NOTIFICATION_TYPES.has(normalizedType)) {
    return normalizedGender === "female";
  }

  return true;
};

export const filterNotificationsForGender = (notifications, gender) =>
  (Array.isArray(notifications) ? notifications : []).filter((item) =>
    isNotificationVisibleForGender(item?.type, gender)
  );
