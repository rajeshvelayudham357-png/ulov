import test from "node:test";
import assert from "node:assert/strict";

import {
  hashDeviceFingerprint,
  parseDeviceRegistrationPayload,
} from "../deviceRegistration.service.js";

test("hashDeviceFingerprint is stable for the same android payload", () => {
  const payload = {
    platform: "android",
    deviceId: "abc123",
    installId: "install-1",
    applicationId: "com.rajenterprise.ulov",
  };

  const first = hashDeviceFingerprint(payload);
  const second = hashDeviceFingerprint(payload);

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("hashDeviceFingerprint ignores installId when native device id is present", () => {
  const firstInstall = hashDeviceFingerprint({
    platform: "android",
    deviceId: "abc123",
    installId: "install-before-reinstall",
    applicationId: "com.rajenterprise.ulov",
  });

  const afterReinstall = hashDeviceFingerprint({
    platform: "android",
    deviceId: "abc123",
    installId: "install-after-reinstall",
    applicationId: "com.rajenterprise.ulov",
  });

  assert.equal(firstInstall, afterReinstall);
});

test("hashDeviceFingerprint changes when device id changes", () => {
  const base = hashDeviceFingerprint({
    platform: "android",
    deviceId: "abc123",
    installId: "install-1",
  });
  const changed = hashDeviceFingerprint({
    platform: "android",
    deviceId: "xyz999",
    installId: "install-1",
  });

  assert.notEqual(base, changed);
});

test("hashDeviceFingerprint falls back to installId when native device id is missing", () => {
  const first = hashDeviceFingerprint({
    platform: "web",
    installId: "install-1",
    applicationId: "com.rajenterprise.ulov",
  });
  const second = hashDeviceFingerprint({
    platform: "web",
    installId: "install-2",
    applicationId: "com.rajenterprise.ulov",
  });

  assert.notEqual(first, second);
});

test("parseDeviceRegistrationPayload accepts legacy androidId alias", () => {
  const parsed = parseDeviceRegistrationPayload({
    androidId: "device-42",
    deviceInstallId: "install-99",
    platform: "android",
    isEmulator: true,
  });

  assert.equal(parsed.deviceId, "device-42");
  assert.equal(parsed.installId, "install-99");
  assert.equal(parsed.platform, "android");
  assert.equal(parsed.isEmulator, true);
});
