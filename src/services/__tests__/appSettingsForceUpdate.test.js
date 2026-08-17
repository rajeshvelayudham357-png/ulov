import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeForceUpdateSettings,
  normalizeNullableBuildNumber,
  validateForceUpdateSettings,
  isValidHttpsStoreUrl,
  mapForceUpdateRow,
} from "../../utils/appSettingsForceUpdate.util.js";

test("normalizeNullableBuildNumber accepts positive integers and null", () => {
  assert.equal(normalizeNullableBuildNumber(null), null);
  assert.equal(normalizeNullableBuildNumber(""), null);
  assert.equal(normalizeNullableBuildNumber(14), 14);
  assert.equal(normalizeNullableBuildNumber("15"), 15);
  assert.equal(normalizeNullableBuildNumber(0), null);
  assert.equal(normalizeNullableBuildNumber("abc"), null);
});

test("isValidHttpsStoreUrl rejects non-https protocols", () => {
  assert.equal(
    isValidHttpsStoreUrl("https://play.google.com/store/apps/details?id=com.test"),
    true
  );
  assert.equal(isValidHttpsStoreUrl("http://example.com"), false);
  assert.equal(isValidHttpsStoreUrl("javascript:alert(1)"), false);
  assert.equal(isValidHttpsStoreUrl(null), true);
});

test("validateForceUpdateSettings rejects min greater than latest", () => {
  const errors = validateForceUpdateSettings({
    forceUpdateEnabled: false,
    minAndroidVersionCode: 20,
    latestAndroidVersionCode: 15,
    minIosBuildNumber: null,
    latestIosBuildNumber: null,
    updateMessage: null,
    playStoreUrl: null,
    appStoreUrl: null,
  });

  assert.match(errors.join(" "), /Minimum Android build number/);
});

test("validateForceUpdateSettings requires minimum when force enabled", () => {
  const errors = validateForceUpdateSettings({
    forceUpdateEnabled: true,
    minAndroidVersionCode: null,
    minIosBuildNumber: null,
    latestAndroidVersionCode: null,
    latestIosBuildNumber: null,
    updateMessage: null,
    playStoreUrl: null,
    appStoreUrl: null,
  });

  assert.match(errors.join(" "), /at least one minimum build number/);
});

test("validateForceUpdateSettings allows force enabled with one platform minimum", () => {
  const errors = validateForceUpdateSettings({
    forceUpdateEnabled: true,
    minAndroidVersionCode: 15,
    minIosBuildNumber: null,
    latestAndroidVersionCode: 20,
    latestIosBuildNumber: null,
    updateMessage: "Update now",
    playStoreUrl: "https://play.google.com/store/apps/details?id=com.test",
    appStoreUrl: null,
  });

  assert.deepEqual(errors, []);
});

test("mergeForceUpdateSettings preserves null build numbers", () => {
  const merged = mergeForceUpdateSettings(
    {
      forceUpdateEnabled: false,
      minAndroidVersionCode: null,
      minIosBuildNumber: 10,
    },
    {
      minAndroidVersionCode: "",
      forceUpdateEnabled: true,
    }
  );

  assert.equal(merged.forceUpdateEnabled, true);
  assert.equal(merged.minAndroidVersionCode, null);
  assert.equal(merged.minIosBuildNumber, 10);
});

test("mapForceUpdateRow returns nulls instead of zero", () => {
  const mapped = mapForceUpdateRow({
    forceUpdateEnabled: 0,
    minAndroidVersionCode: null,
    minIosBuildNumber: null,
    latestAndroidVersionCode: null,
    latestIosBuildNumber: null,
    updateMessage: null,
    playStoreUrl: null,
    appStoreUrl: null,
  });

  assert.equal(mapped.forceUpdateEnabled, false);
  assert.equal(mapped.minAndroidVersionCode, null);
  assert.equal(mapped.minIosBuildNumber, null);
});
