import crypto from "crypto";
import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";

const DEFAULT_APP_PACKAGE = "com.rajenterprise.ulov";

let tableReady = false;

const getMaxAccountsPerDevice = () => {
  const parsed = Number(process.env.DEVICE_MAX_ACCOUNTS_PER_DEVICE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const shouldBlockEmulators = () =>
  String(process.env.DEVICE_BLOCK_EMULATORS ?? "true").toLowerCase() !== "false";

export const hashDeviceFingerprint = ({
  platform,
  deviceId,
  installId,
  applicationId,
} = {}) => {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();
  const normalizedDeviceId = String(deviceId || "").trim();
  const normalizedInstallId = String(installId || "").trim();
  const normalizedApplicationId = String(
    applicationId || DEFAULT_APP_PACKAGE
  ).trim();

  if (!normalizedDeviceId && !normalizedInstallId) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(
      [
        normalizedPlatform,
        normalizedDeviceId,
        normalizedInstallId,
        normalizedApplicationId,
      ].join("|")
    )
    .digest("hex");
};

export const parseDeviceRegistrationPayload = (body = {}) => ({
  platform: String(body.platform || body.devicePlatform || "")
    .trim()
    .toLowerCase(),
  deviceId: String(body.deviceId || body.androidId || "").trim(),
  installId: String(body.installId || body.deviceInstallId || "").trim(),
  deviceModel: String(body.deviceModel || "").trim().slice(0, 120),
  osVersion: String(body.osVersion || "").trim().slice(0, 40),
  isEmulator: Boolean(body.isEmulator),
  applicationId: String(body.applicationId || "").trim(),
});

export const ensureUserDeviceRegistrationTable = async () => {
  if (tableReady) {
    return;
  }

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_device_registrations (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT NOT NULL,
      deviceHash CHAR(64) NOT NULL,
      platform VARCHAR(20) NULL,
      deviceModel VARCHAR(120) NULL,
      osVersion VARCHAR(40) NULL,
      isEmulator TINYINT(1) NOT NULL DEFAULT 0,
      firstSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY user_device_unique (userId, deviceHash),
      KEY device_hash_idx (deviceHash)
    )`
  );

  tableReady = true;
};

export const countRegisteredUsersOnDevice = async (
  deviceHash,
  excludeUserId = null
) => {
  await ensureUserDeviceRegistrationTable();

  if (!deviceHash) {
    return 0;
  }

  const rows = await sequelize.query(
    `SELECT COUNT(DISTINCT udr.userId) AS userCount
     FROM user_device_registrations udr
     INNER JOIN users u ON u.id = udr.userId
     WHERE udr.deviceHash = :deviceHash
       AND COALESCE(u.blocked, 0) = 0
       AND COALESCE(u.accountStatus, '') <> 'deleted'
       AND (:excludeUserId IS NULL OR udr.userId <> :excludeUserId)`,
    {
      replacements: {
        deviceHash,
        excludeUserId: excludeUserId ?? null,
      },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.userCount) || 0;
};

export const getRegisteredUserIdsOnDevice = async (deviceHash) => {
  await ensureUserDeviceRegistrationTable();

  if (!deviceHash) {
    return [];
  }

  const rows = await sequelize.query(
    `SELECT DISTINCT udr.userId AS userId
     FROM user_device_registrations udr
     INNER JOIN users u ON u.id = udr.userId
     WHERE udr.deviceHash = :deviceHash
       AND COALESCE(u.blocked, 0) = 0
       AND COALESCE(u.accountStatus, '') <> 'deleted'`,
    {
      replacements: { deviceHash },
      type: QueryTypes.SELECT,
    }
  );

  return rows
    .map((row) => Number(row.userId))
    .filter(Number.isFinite);
};

export const assertDeviceAllowedForRegistration = async ({
  payload,
  excludeUserId = null,
} = {}) => {
  const device = parseDeviceRegistrationPayload(payload);
  const deviceHash = hashDeviceFingerprint(device);

  if (device.platform === "android" && !deviceHash) {
    return {
      ok: false,
      status: 400,
      code: "DEVICE_ID_REQUIRED",
      message:
        "Device verification failed. Please update the app and try again.",
    };
  }

  if (!deviceHash) {
    return {
      ok: true,
      skipped: true,
      device,
      deviceHash: null,
    };
  }

  if (shouldBlockEmulators() && device.isEmulator) {
    return {
      ok: false,
      status: 403,
      code: "EMULATOR_NOT_ALLOWED",
      message: "Registration is not allowed on emulators.",
    };
  }

  const maxAccounts = getMaxAccountsPerDevice();
  const existingCount = await countRegisteredUsersOnDevice(
    deviceHash,
    excludeUserId
  );

  if (existingCount >= maxAccounts) {
    return {
      ok: false,
      status: 409,
      code: "DEVICE_ALREADY_REGISTERED",
      message:
        "This device already has a registered account. Please login with your existing mobile number.",
    };
  }

  return {
    ok: true,
    device,
    deviceHash,
  };
};

export const registerUserDevice = async (userId, { device, deviceHash }) => {
  await ensureUserDeviceRegistrationTable();

  const normalizedUserId = Number(userId);
  const normalizedHash = String(deviceHash || "").trim();

  if (!Number.isFinite(normalizedUserId) || !normalizedHash) {
    return null;
  }

  await sequelize.query(
    `INSERT INTO user_device_registrations
      (userId, deviceHash, platform, deviceModel, osVersion, isEmulator)
     VALUES
      (:userId, :deviceHash, :platform, :deviceModel, :osVersion, :isEmulator)
     ON DUPLICATE KEY UPDATE
       platform = VALUES(platform),
       deviceModel = VALUES(deviceModel),
       osVersion = VALUES(osVersion),
       isEmulator = VALUES(isEmulator),
       lastSeenAt = NOW()`,
    {
      replacements: {
        userId: normalizedUserId,
        deviceHash: normalizedHash,
        platform: device?.platform || null,
        deviceModel: device?.deviceModel || null,
        osVersion: device?.osVersion || null,
        isEmulator: device?.isEmulator ? 1 : 0,
      },
    }
  );

  return normalizedHash;
};

export const enforceDeviceRegistration = async ({
  req,
  userId,
  isNewRegistration,
  excludeUserId = null,
}) => {
  const device = parseDeviceRegistrationPayload(req.body);
  const deviceHash = hashDeviceFingerprint(device);

  if (isNewRegistration) {
    const check = await assertDeviceAllowedForRegistration({
      payload: req.body,
      excludeUserId,
    });

    if (!check.ok) {
      return check;
    }

    if (userId && deviceHash) {
      await registerUserDevice(userId, { device, deviceHash });
    }
  }

  return {
    ok: true,
    device,
    deviceHash,
  };
};
