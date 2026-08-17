export const DEFAULT_FORCE_UPDATE_MESSAGE =
  "A new version of ULOV is available. Please update to continue.";

export const MAX_UPDATE_MESSAGE_LENGTH = 500;

export const normalizeNullableBuildNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return Math.round(parsed);
};

export const normalizeUpdateMessage = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, MAX_UPDATE_MESSAGE_LENGTH);
};

export const normalizeStoreUrl = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();

  if (!trimmed) {
    return null;
  }

  return trimmed;
};

export const isValidHttpsStoreUrl = (value) => {
  if (value === null || value === undefined || value === "") {
    return true;
  }

  try {
    const url = new URL(String(value).trim());
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

export const mergeForceUpdateSettings = (current = {}, patch = {}) => ({
  forceUpdateEnabled:
    patch.forceUpdateEnabled !== undefined
      ? Boolean(patch.forceUpdateEnabled)
      : Boolean(current.forceUpdateEnabled),
  minAndroidVersionCode:
    patch.minAndroidVersionCode !== undefined
      ? normalizeNullableBuildNumber(patch.minAndroidVersionCode)
      : normalizeNullableBuildNumber(current.minAndroidVersionCode),
  minIosBuildNumber:
    patch.minIosBuildNumber !== undefined
      ? normalizeNullableBuildNumber(patch.minIosBuildNumber)
      : normalizeNullableBuildNumber(current.minIosBuildNumber),
  latestAndroidVersionCode:
    patch.latestAndroidVersionCode !== undefined
      ? normalizeNullableBuildNumber(patch.latestAndroidVersionCode)
      : normalizeNullableBuildNumber(current.latestAndroidVersionCode),
  latestIosBuildNumber:
    patch.latestIosBuildNumber !== undefined
      ? normalizeNullableBuildNumber(patch.latestIosBuildNumber)
      : normalizeNullableBuildNumber(current.latestIosBuildNumber),
  updateMessage:
    patch.updateMessage !== undefined
      ? normalizeUpdateMessage(patch.updateMessage)
      : normalizeUpdateMessage(current.updateMessage),
  playStoreUrl:
    patch.playStoreUrl !== undefined
      ? normalizeStoreUrl(patch.playStoreUrl)
      : normalizeStoreUrl(current.playStoreUrl),
  appStoreUrl:
    patch.appStoreUrl !== undefined
      ? normalizeStoreUrl(patch.appStoreUrl)
      : normalizeStoreUrl(current.appStoreUrl),
});

export const validateForceUpdateSettings = (settings = {}) => {
  const errors = [];

  if (
    settings.updateMessage &&
    settings.updateMessage.length > MAX_UPDATE_MESSAGE_LENGTH
  ) {
    errors.push(
      `Update message must be ${MAX_UPDATE_MESSAGE_LENGTH} characters or fewer.`
    );
  }

  if (!isValidHttpsStoreUrl(settings.playStoreUrl)) {
    errors.push("Google Play Store URL must be a valid HTTPS URL.");
  }

  if (!isValidHttpsStoreUrl(settings.appStoreUrl)) {
    errors.push("Apple App Store URL must be a valid HTTPS URL.");
  }

  if (
    settings.minAndroidVersionCode !== null &&
    settings.latestAndroidVersionCode !== null &&
    settings.minAndroidVersionCode > settings.latestAndroidVersionCode
  ) {
    errors.push(
      "Minimum Android build number cannot be greater than latest Android build number."
    );
  }

  if (
    settings.minIosBuildNumber !== null &&
    settings.latestIosBuildNumber !== null &&
    settings.minIosBuildNumber > settings.latestIosBuildNumber
  ) {
    errors.push(
      "Minimum iOS build number cannot be greater than latest iOS build number."
    );
  }

  if (settings.forceUpdateEnabled) {
    if (
      settings.minAndroidVersionCode === null &&
      settings.minIosBuildNumber === null
    ) {
      errors.push(
        "Configure at least one minimum build number before enabling force update."
      );
    }
  }

  return errors;
};

export const mapForceUpdateRow = (row = {}) => ({
  forceUpdateEnabled: Boolean(Number(row.forceUpdateEnabled ?? 0)),
  minAndroidVersionCode: normalizeNullableBuildNumber(
    row.minAndroidVersionCode
  ),
  minIosBuildNumber: normalizeNullableBuildNumber(row.minIosBuildNumber),
  latestAndroidVersionCode: normalizeNullableBuildNumber(
    row.latestAndroidVersionCode
  ),
  latestIosBuildNumber: normalizeNullableBuildNumber(row.latestIosBuildNumber),
  updateMessage: normalizeUpdateMessage(row.updateMessage),
  playStoreUrl: normalizeStoreUrl(row.playStoreUrl),
  appStoreUrl: normalizeStoreUrl(row.appStoreUrl),
});
