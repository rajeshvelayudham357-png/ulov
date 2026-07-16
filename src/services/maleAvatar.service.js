export const MALE_AVATAR_KEYS = [
  "mava1",
  "mava2",
  "mava3",
  "mava4",
  "mava5",
  "mava6",
  "mava7",
  "mava8",
];

export const pickRandomMaleAvatarKey = () =>
  MALE_AVATAR_KEYS[
    Math.floor(Math.random() * MALE_AVATAR_KEYS.length)
  ] ?? "mava1";

export const isMaleAvatarKey = (value) =>
  MALE_AVATAR_KEYS.includes(
    String(value ?? "").trim().toLowerCase()
  );

export const resolveMaleAvatarForProfile = ({
  avatar,
  gender,
}) => {
  if (String(gender ?? "") !== "Male") {
    return avatar;
  }

  const normalized = String(avatar ?? "").trim().toLowerCase();

  if (isMaleAvatarKey(normalized)) {
    return normalized;
  }

  if (!normalized || normalized === "ava1") {
    return pickRandomMaleAvatarKey();
  }

  return avatar;
};
