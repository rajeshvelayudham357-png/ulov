import { QueryTypes } from "sequelize";

import { sequelize } from "../../../config/database.js";
import { QC_TABLES } from "../../../constants/quickConnect.js";
import { CallHistory, User, Wallet } from "../../../models/index.js";
import { getAppSettings, updateAppSettings } from "../../appSettings.service.js";
import { ensureQuickConnectSchema } from "../../quickConnectSchema.service.js";
import { setQuickConnectRuntime } from "../../quickConnect.service.js";
import { releaseCreatorReservation } from "../../creatorReservation.service.js";

export const TEST_PREFIX = 881000;

export const IDS = {
  MALE: TEST_PREFIX + 1,
  CREATOR_A: TEST_PREFIX + 2,
  CREATOR_B: TEST_PREFIX + 3,
  CREATOR_C: TEST_PREFIX + 4,
  CREATOR_BLOCKED: TEST_PREFIX + 5,
  CREATOR_OFFLINE: TEST_PREFIX + 6,
  CREATOR_NO_AUTO: TEST_PREFIX + 7,
  BUSY_CALLER: TEST_PREFIX + 8,
};

export const getInsertId = (queryResult) => {
  const [first, second] = queryResult;

  if (second && typeof second === "object" && second.insertId != null) {
    return Number(second.insertId);
  }

  return Number(first);
};

export const createMockRes = () => {
  let statusCode = 200;
  let body = null;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
};

export const installMockRuntime = () => {
  const emitted = [];

  const io = {
    to: () => ({
      emit: (event, payload) => {
        emitted.push({ event, payload });
      },
    }),
  };

  const onlineUsers = new Map();

  setQuickConnectRuntime({ io, onlineUsers });

  return {
    emitted,
    clear: () => {
      emitted.length = 0;
    },
  };
};

export const upsertTestUser = async ({
  id,
  gender,
  online = true,
  accountStatus = "approved",
  acceptAutoRoutedCalls = false,
  acceptVoiceCalls = true,
  acceptVideoCalls = true,
  blocked = false,
  nickname = "Test User",
}) => {
  const phone = `+881${String(id).slice(-7)}`;

  const existing = await User.findByPk(id);

  const values = {
    gender,
    online,
    accountStatus,
    acceptAutoRoutedCalls,
    acceptVoiceCalls,
    acceptVideoCalls,
    blocked,
    nickname,
    name: nickname,
    phone,
    lastLoginAt: new Date(),
  };

  if (existing) {
    await existing.update(values);
    return existing;
  }

  return User.create({
    id,
    ...values,
  });
};

export const upsertTestWallet = async (userId, balance = 10_000) => {
  const existing = await Wallet.findOne({ where: { userId } });

  if (existing) {
    await existing.update({ balance });
    return existing;
  }

  return Wallet.create({
    userId,
    balance,
  });
};

export const seedEligibleCreators = async () => {
  await ensureQuickConnectSchema({ force: true });

  await upsertTestUser({
    id: IDS.MALE,
    gender: "Male",
    online: true,
  });

  await upsertTestWallet(IDS.MALE, 10_000);

  await upsertTestUser({
    id: IDS.CREATOR_A,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: true,
    nickname: "Creator A",
  });

  await upsertTestUser({
    id: IDS.CREATOR_B,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: true,
    nickname: "Creator B",
  });

  await upsertTestUser({
    id: IDS.CREATOR_C,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: true,
    nickname: "Creator C",
  });

  await upsertTestUser({
    id: IDS.CREATOR_BLOCKED,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: true,
    nickname: "Blocked Creator",
  });

  await upsertTestUser({
    id: IDS.CREATOR_OFFLINE,
    gender: "Female",
    online: false,
    acceptAutoRoutedCalls: true,
    nickname: "Offline Creator",
  });

  await upsertTestUser({
    id: IDS.CREATOR_NO_AUTO,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: false,
    nickname: "No Auto Route",
  });

  await upsertTestUser({
    id: IDS.BUSY_CALLER,
    gender: "Male",
    online: true,
    nickname: "Busy Caller",
  });

  await sequelize.query(
    `INSERT INTO blocks (blockerId, blockedUserId, createdAt, updatedAt)
     VALUES (:blockerId, :blockedUserId, NOW(), NOW())
     ON DUPLICATE KEY UPDATE updatedAt = NOW()`,
    {
      replacements: {
        blockerId: IDS.MALE,
        blockedUserId: IDS.CREATOR_BLOCKED,
      },
    }
  ).catch(() => {});
};

export const withQuickConnectEnabled = async (enabled, fn) => {
  const current = await getAppSettings();
  const previous = Boolean(current.quickConnectEnabled);

  await updateAppSettings({
    quickConnectEnabled: enabled ? 1 : 0,
  });

  try {
    return await fn();
  } finally {
    await updateAppSettings({
      quickConnectEnabled: previous ? 1 : 0,
    });
  }
};

export const fetchSessionRow = async (sessionId) => {
  const rows = await sequelize.query(
    `SELECT * FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId LIMIT 1`,
    {
      replacements: { sessionId: Number(sessionId) },
      type: QueryTypes.SELECT,
    }
  );

  return rows[0] || null;
};

export const fetchAttemptRows = async (sessionId) => {
  return sequelize.query(
    `SELECT * FROM ${QC_TABLES.ATTEMPTS} WHERE sessionId = :sessionId ORDER BY attemptNumber ASC`,
    {
      replacements: { sessionId: Number(sessionId) },
      type: QueryTypes.SELECT,
    }
  );
};

export const countQcSessionsForCaller = async (callerId) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS total FROM ${QC_TABLES.SESSIONS} WHERE callerId = :callerId`,
    {
      replacements: { callerId: Number(callerId) },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.total ?? 0);
};

export const cleanupQcArtifacts = async ({
  sessionIds = [],
  callHistoryIds = [],
  creatorIds = [],
} = {}) => {
  for (const creatorId of creatorIds) {
    await releaseCreatorReservation({ creatorId }).catch(() => {});
  }

  for (const sessionId of sessionIds) {
    await sequelize.query(
      `DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE sessionId = :sessionId`,
      { replacements: { sessionId: Number(sessionId) } }
    );
    await sequelize.query(
      `DELETE FROM ${QC_TABLES.SESSIONS} WHERE id = :sessionId`,
      { replacements: { sessionId: Number(sessionId) } }
    );
  }

  for (const callHistoryId of callHistoryIds) {
    await CallHistory.destroy({ where: { id: callHistoryId } }).catch(() => {});
  }
};

export const cleanupAllHarnessData = async () => {
  await sequelize.query(
    `DELETE FROM ${QC_TABLES.ATTEMPTS} WHERE sessionId IN (
       SELECT id FROM ${QC_TABLES.SESSIONS} WHERE callerId >= :minId
     )`,
    { replacements: { minId: TEST_PREFIX } }
  ).catch(() => {});

  await sequelize.query(
    `DELETE FROM ${QC_TABLES.SESSIONS} WHERE callerId >= :minId`,
    { replacements: { minId: TEST_PREFIX } }
  );

  await sequelize.query(
    `DELETE FROM creator_call_reservations WHERE creatorId >= :minId`,
    { replacements: { minId: TEST_PREFIX } }
  );

  await sequelize.query(
    `DELETE FROM call_histories WHERE callerId >= :minId OR receiverId >= :minId`,
    { replacements: { minId: TEST_PREFIX } }
  );

  await sequelize.query(
    `DELETE FROM blocks WHERE blockerId >= :minId OR blockedUserId >= :minId`,
    { replacements: { minId: TEST_PREFIX } }
  ).catch(() => {});

  for (const id of Object.values(IDS)) {
    await releaseCreatorReservation({ creatorId: id }).catch(() => {});
    await User.destroy({ where: { id } }).catch(() => {});
    await Wallet.destroy({ where: { userId: id } }).catch(() => {});
  }
};
