import { Op, QueryTypes } from "sequelize";

import { MALE_TASK_DEFINITIONS } from "../constants/maleTasks.js";
import { sequelize } from "../config/database.js";
import {
  CallHistory,
  Favorite,
  User,
  Wallet,
  WalletTransaction,
} from "../models/index.js";
import {
  clipSecondsToWindow,
  getIndiaDateKey,
  getIstDayBounds,
  getMsUntilIstMidnight,
  getNightOwlWindowBounds,
  getPreviousIndiaDateKey,
  isVideoCallType,
  normalizeCallType,
} from "./maleTaskDuration.util.js";

let masterTasksReady = false;
let claimsReady = false;
let progressReady = false;
let streaksReady = false;

const WALLET_TX_TYPE = "male_task_reward";
const WALLET_REF_TYPE = "male_task";

const parseRequirements = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const parseDateMaybe = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const normalizeTask = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  icon: row.icon || null,
  rewardCoins: Number(row.rewardCoins) || 0,
  cadence: row.cadence || "daily",
  requirements: parseRequirements(row.requirements),
  active: Boolean(row.active),
  sortOrder: Number(row.sortOrder) || 0,
  startAt: row.startAt || null,
  endAt: row.endAt || null,
  deletedAt: row.deletedAt || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const slugifyTaskId = (title) =>
  String(title || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "task";

const isMaleUser = (user) =>
  String(user?.gender || "")
    .trim()
    .toLowerCase() === "male";

const taskIsWithinCampaign = (task, now = new Date()) => {
  const startAt = parseDateMaybe(task.startAt);
  const endAt = parseDateMaybe(task.endAt);
  if (startAt && now < startAt) return false;
  if (endAt && now > endAt) return false;
  return true;
};

const ensureColumn = async (table, column, definition) => {
  const [row] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column
     LIMIT 1`,
    {
      replacements: { table, column },
      type: QueryTypes.SELECT,
    }
  );
  if (!row) {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

export const ensureMaleTaskSchema = async () => {
  await ensureMasterTasksTable();
  await ensureClaimsTable();
  await ensureProgressTable();
  await ensureStreaksTable();
};

const ensureMasterTasksTable = async () => {
  if (masterTasksReady) return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS male_master_tasks (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      description TEXT NULL,
      icon VARCHAR(40) NULL,
      rewardCoins INT NOT NULL DEFAULT 0,
      cadence VARCHAR(20) NOT NULL DEFAULT 'daily',
      requirements JSON NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      sortOrder INT NOT NULL DEFAULT 0,
      startAt DATETIME NULL,
      endAt DATETIME NULL,
      deletedAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureColumn("male_master_tasks", "icon", "VARCHAR(40) NULL");
  await ensureColumn("male_master_tasks", "startAt", "DATETIME NULL");
  await ensureColumn("male_master_tasks", "endAt", "DATETIME NULL");
  await ensureColumn("male_master_tasks", "deletedAt", "DATETIME NULL");

  for (let index = 0; index < MALE_TASK_DEFINITIONS.length; index += 1) {
    const task = MALE_TASK_DEFINITIONS[index];
    await sequelize.query(
      `INSERT IGNORE INTO male_master_tasks
        (id, title, description, icon, rewardCoins, cadence, requirements, active, sortOrder)
       VALUES
        (:id, :title, :description, :icon, :rewardCoins, :cadence, :requirements, 1, :sortOrder)`,
      {
        replacements: {
          id: task.id,
          title: task.title,
          description: task.description,
          icon: task.icon || null,
          rewardCoins: task.rewardCoins,
          cadence: task.cadence,
          requirements: JSON.stringify(task.requirements || {}),
          sortOrder: index + 1,
        },
      }
    );
  }

  masterTasksReady = true;
};

const ensureClaimsTable = async () => {
  if (claimsReady) return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS male_task_claims (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT NOT NULL,
      taskId VARCHAR(64) NOT NULL,
      claimKey VARCHAR(64) NOT NULL,
      rewardCoins INT NOT NULL DEFAULT 0,
      walletTransactionId BIGINT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_male_task_claim (userId, taskId, claimKey),
      KEY idx_male_task_claims_user (userId),
      KEY idx_male_task_claims_task (taskId),
      KEY idx_male_task_claims_created (createdAt)
    )
  `);

  await ensureColumn("male_task_claims", "walletTransactionId", "BIGINT NULL");
  claimsReady = true;
};

const ensureProgressTable = async () => {
  if (progressReady) return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS male_task_progress (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT NOT NULL,
      taskId VARCHAR(64) NOT NULL,
      progressDate VARCHAR(32) NOT NULL,
      currentProgress INT NOT NULL DEFAULT 0,
      targetProgress INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
      completedAt DATETIME NULL,
      claimedAt DATETIME NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_male_task_progress (userId, taskId, progressDate),
      KEY idx_male_task_progress_user_date (userId, progressDate)
    )
  `);

  progressReady = true;
};

const ensureStreaksTable = async () => {
  if (streaksReady) return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS male_task_streaks (
      userId BIGINT NOT NULL PRIMARY KEY,
      currentStreak INT NOT NULL DEFAULT 0,
      lastQualifyingDate VARCHAR(10) NULL,
      cycleStartDate VARCHAR(10) NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  streaksReady = true;
};

export const getMasterMaleTasks = async ({
  includeInactive = false,
  includeDeleted = false,
} = {}) => {
  await ensureMasterTasksTable();

  const conditions = [
    ...(includeInactive ? [] : ["active = 1"]),
    ...(includeDeleted ? [] : ["deletedAt IS NULL"]),
  ];

  const rows = await sequelize.query(
    `SELECT *
     FROM male_master_tasks
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY sortOrder ASC, createdAt ASC`,
    { type: QueryTypes.SELECT }
  );

  return rows.map(normalizeTask);
};

export const getMaleTaskDefinition = async (
  taskId,
  { includeDeleted = false } = {}
) => {
  const tasks = await getMasterMaleTasks({
    includeInactive: true,
    includeDeleted,
  });
  return tasks.find((task) => task.id === taskId) || null;
};

export const createMasterMaleTask = async (task) => {
  await ensureMasterTasksTable();

  const baseId = slugifyTaskId(task.id || task.title);
  let id = baseId;
  let suffix = 1;

  while (await getMaleTaskDefinition(id, { includeDeleted: true })) {
    suffix += 1;
    id = `${baseId}_${suffix}`;
  }

  const cadence = ["daily", "weekly"].includes(task.cadence)
    ? task.cadence
    : "daily";

  await sequelize.query(
    `INSERT INTO male_master_tasks
      (id, title, description, icon, rewardCoins, cadence, requirements, active, sortOrder, startAt, endAt)
     VALUES
      (:id, :title, :description, :icon, :rewardCoins, :cadence, :requirements, :active, :sortOrder, :startAt, :endAt)`,
    {
      replacements: {
        id,
        title: task.title,
        description: task.description || "",
        icon: task.icon || null,
        rewardCoins: Number(task.rewardCoins) || 0,
        cadence,
        requirements: JSON.stringify(task.requirements || {}),
        active: task.active === false ? 0 : 1,
        sortOrder: Number(task.sortOrder) || 0,
        startAt: task.startAt || null,
        endAt: task.endAt || null,
      },
    }
  );

  return getMaleTaskDefinition(id);
};

export const updateMasterMaleTask = async (taskId, task) => {
  await ensureMasterTasksTable();

  const existing = await getMaleTaskDefinition(taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  if (task.title !== undefined && !String(task.title || "").trim()) {
    throw new Error("Task title is required");
  }

  if (task.rewardCoins !== undefined && !(Number(task.rewardCoins) >= 0)) {
    throw new Error("Reward coins cannot be negative");
  }

  if (
    task.cadence !== undefined &&
    !["daily", "weekly"].includes(task.cadence)
  ) {
    throw new Error("Cadence must be daily or weekly");
  }

  const next = {
    title: task.title ?? existing.title,
    description: task.description ?? existing.description,
    icon: task.icon ?? existing.icon,
    rewardCoins: task.rewardCoins ?? existing.rewardCoins,
    cadence: task.cadence ?? existing.cadence,
    requirements: task.requirements ?? existing.requirements,
    active: task.active ?? existing.active,
    sortOrder: task.sortOrder ?? existing.sortOrder,
    startAt:
      task.startAt !== undefined ? task.startAt || null : existing.startAt,
    endAt: task.endAt !== undefined ? task.endAt || null : existing.endAt,
  };

  await sequelize.query(
    `UPDATE male_master_tasks
     SET title = :title,
         description = :description,
         icon = :icon,
         rewardCoins = :rewardCoins,
         cadence = :cadence,
         requirements = :requirements,
         active = :active,
         sortOrder = :sortOrder,
         startAt = :startAt,
         endAt = :endAt,
         updatedAt = NOW()
     WHERE id = :taskId
       AND deletedAt IS NULL`,
    {
      replacements: {
        taskId,
        title: next.title,
        description: next.description,
        icon: next.icon || null,
        rewardCoins: Number(next.rewardCoins) || 0,
        cadence: next.cadence || "daily",
        requirements: JSON.stringify(next.requirements || {}),
        active: next.active ? 1 : 0,
        sortOrder: Number(next.sortOrder) || 0,
        startAt: next.startAt,
        endAt: next.endAt,
      },
    }
  );

  return getMaleTaskDefinition(taskId);
};

export const deleteMasterMaleTask = async (taskId) => {
  await ensureMasterTasksTable();

  const [, metadata] = await sequelize.query(
    `UPDATE male_master_tasks
     SET deletedAt = NOW(),
         active = 0,
         updatedAt = NOW()
     WHERE id = :taskId
       AND deletedAt IS NULL`,
    { replacements: { taskId } }
  );

  if (!Number(metadata?.affectedRows ?? 0)) {
    throw new Error("Task not found");
  }

  return { id: taskId, deleted: true };
};

const assertMaleUser = async (userId) => {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error("Valid user id is required");
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "gender"],
  });

  if (!user || !isMaleUser(user)) {
    throw new Error("Male tasks are available for male users only");
  }

  return numericUserId;
};

const loadQualifyingCallsForDay = async (userId, dateKey) => {
  const { start, end } = getIstDayBounds(dateKey);

  const rows = await CallHistory.findAll({
    where: {
      callerId: userId,
      status: "completed",
      acceptedAt: {
        [Op.ne]: null,
        [Op.gte]: start,
        [Op.lt]: end,
      },
      settledAt: { [Op.ne]: null },
    },
    attributes: [
      "id",
      "callerId",
      "receiverId",
      "type",
      "duration",
      "acceptedAt",
      "endedAt",
      "settledAt",
      "status",
    ],
  });

  return rows
    .filter(
      (call) =>
        Number(call.callerId) !== Number(call.receiverId) &&
        Number(call.duration ?? 0) >= 0
    )
    .map((call) => ({
      id: Number(call.id),
      callerId: Number(call.callerId),
      receiverId: Number(call.receiverId),
      type: normalizeCallType(call.type),
      duration: Number(call.duration ?? 0),
      acceptedAt: call.acceptedAt,
      endedAt: call.endedAt || call.settledAt,
      settledAt: call.settledAt,
    }));
};

/** Calls that may overlap the Night Owl window (accepted before end, ended after start). */
const loadCallsOverlappingNightOwl = async (userId, dateKey, requirements) => {
  const { start, end } = getNightOwlWindowBounds(dateKey, {
    startHour: Number(requirements.windowStartHour) || 21,
    endHour: Number(requirements.windowEndHour) || 24,
  });

  const rows = await CallHistory.findAll({
    where: {
      callerId: userId,
      status: "completed",
      acceptedAt: { [Op.ne]: null, [Op.lt]: end },
      settledAt: { [Op.ne]: null },
      endedAt: { [Op.gt]: start },
    },
    attributes: [
      "id",
      "callerId",
      "receiverId",
      "type",
      "duration",
      "acceptedAt",
      "endedAt",
      "settledAt",
    ],
  });

  return {
    window: { start, end },
    calls: rows
      .filter((call) => Number(call.callerId) !== Number(call.receiverId))
      .map((call) => ({
        id: Number(call.id),
        duration: Number(call.duration ?? 0),
        acceptedAt: call.acceptedAt,
        endedAt: call.endedAt || call.settledAt,
      })),
  };
};

const loadFavouriteMap = async (userId, receiverIds) => {
  if (!receiverIds.length) return new Map();

  const rows = await Favorite.findAll({
    where: {
      userId,
      favoriteUserId: { [Op.in]: receiverIds },
    },
    attributes: ["favoriteUserId", "createdAt"],
  });

  const map = new Map();
  for (const row of rows) {
    map.set(Number(row.favoriteUserId), row.createdAt);
  }
  return map;
};

const getClaimedTaskKeys = async (userId) => {
  await ensureClaimsTable();

  const rows = await sequelize.query(
    `SELECT taskId, claimKey FROM male_task_claims WHERE userId = :userId`,
    {
      replacements: { userId },
      type: QueryTypes.SELECT,
    }
  );

  return new Set(rows.map((row) => `${row.taskId}:${row.claimKey}`));
};

const getStreakRow = async (userId, { transaction } = {}) => {
  await ensureStreaksTable();

  const [row] = await sequelize.query(
    `SELECT userId, currentStreak, lastQualifyingDate, cycleStartDate
     FROM male_task_streaks
     WHERE userId = :userId
     LIMIT 1`,
    {
      replacements: { userId },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  return (
    row || {
      userId,
      currentStreak: 0,
      lastQualifyingDate: null,
      cycleStartDate: null,
    }
  );
};

/**
 * Updates weekly streak when the user has at least one qualifying (>=60s) call today.
 */
export const syncMaleTaskStreak = async (
  userId,
  { dateKey = getIndiaDateKey(), hasQualifyingCall = false, transaction } = {}
) => {
  await ensureStreaksTable();

  const existing = await getStreakRow(userId, { transaction });
  let currentStreak = Number(existing.currentStreak) || 0;
  let lastQualifyingDate = existing.lastQualifyingDate || null;
  let cycleStartDate = existing.cycleStartDate || null;

  if (hasQualifyingCall) {
    if (lastQualifyingDate === dateKey) {
      // already counted today
    } else if (lastQualifyingDate === getPreviousIndiaDateKey(dateKey)) {
      currentStreak += 1;
      if (!cycleStartDate) {
        cycleStartDate = lastQualifyingDate;
      }
    } else {
      currentStreak = 1;
      cycleStartDate = dateKey;
    }
    lastQualifyingDate = dateKey;
  } else if (lastQualifyingDate && lastQualifyingDate !== dateKey) {
    const yesterday = getPreviousIndiaDateKey(dateKey);
    if (lastQualifyingDate !== yesterday && lastQualifyingDate !== dateKey) {
      currentStreak = 0;
      cycleStartDate = null;
    }
  }

  await sequelize.query(
    `INSERT INTO male_task_streaks
      (userId, currentStreak, lastQualifyingDate, cycleStartDate)
     VALUES
      (:userId, :currentStreak, :lastQualifyingDate, :cycleStartDate)
     ON DUPLICATE KEY UPDATE
      currentStreak = VALUES(currentStreak),
      lastQualifyingDate = VALUES(lastQualifyingDate),
      cycleStartDate = VALUES(cycleStartDate),
      updatedAt = CURRENT_TIMESTAMP`,
    {
      replacements: {
        userId,
        currentStreak,
        lastQualifyingDate,
        cycleStartDate,
      },
      transaction,
    }
  );

  return {
    currentStreak,
    lastQualifyingDate,
    cycleStartDate,
  };
};

const upsertProgressRow = async ({
  userId,
  taskId,
  progressDate,
  currentProgress,
  targetProgress,
  status,
  completedAt,
  claimedAt,
  transaction,
}) => {
  await ensureProgressTable();

  await sequelize.query(
    `INSERT INTO male_task_progress
      (userId, taskId, progressDate, currentProgress, targetProgress, status, completedAt, claimedAt)
     VALUES
      (:userId, :taskId, :progressDate, :currentProgress, :targetProgress, :status, :completedAt, :claimedAt)
     ON DUPLICATE KEY UPDATE
      currentProgress = VALUES(currentProgress),
      targetProgress = VALUES(targetProgress),
      status = VALUES(status),
      completedAt = VALUES(completedAt),
      claimedAt = COALESCE(VALUES(claimedAt), claimedAt),
      updatedAt = CURRENT_TIMESTAMP`,
    {
      replacements: {
        userId,
        taskId,
        progressDate,
        currentProgress,
        targetProgress,
        status,
        completedAt,
        claimedAt,
      },
      transaction,
    }
  );
};

const computeDayAggregates = async (userId, dateKey) => {
  const calls = await loadQualifyingCallsForDay(userId, dateKey);
  const favouriteMap = await loadFavouriteMap(
    userId,
    [...new Set(calls.map((call) => call.receiverId))]
  );

  const minSixty = calls.filter((call) => call.duration >= 60);
  const totalDuration = calls.reduce((sum, call) => sum + call.duration, 0);
  const videoDuration = calls
    .filter((call) => isVideoCallType(call.type))
    .reduce((sum, call) => sum + call.duration, 0);

  let favouriteBestDuration = 0;
  for (const call of calls) {
    const favAt = favouriteMap.get(call.receiverId);
    if (!favAt) continue;
    const acceptMs = new Date(call.acceptedAt).getTime();
    const favMs = new Date(favAt).getTime();
    if (!Number.isFinite(acceptMs) || !Number.isFinite(favMs)) continue;
    if (favMs <= acceptMs) {
      favouriteBestDuration = Math.max(favouriteBestDuration, call.duration);
    }
  }

  return {
    calls,
    qualifyingCallCount: minSixty.length,
    hasQualifyingCall: minSixty.length > 0,
    totalDuration,
    videoDuration,
    favouriteBestDuration,
  };
};

const computeNightOwlSeconds = async (userId, dateKey, requirements = {}) => {
  const { window, calls } = await loadCallsOverlappingNightOwl(
    userId,
    dateKey,
    requirements
  );

  let seconds = 0;
  const seen = new Set();
  for (const call of calls) {
    if (seen.has(call.id)) continue;
    seen.add(call.id);
    seconds += clipSecondsToWindow(
      call.acceptedAt,
      call.endedAt,
      window.start,
      window.end
    );
  }
  return seconds;
};

const buildProgressPayload = ({
  task,
  current,
  target,
  claimed,
  claimKey,
  expired = false,
  extra = {},
}) => {
  const safeTarget = Math.max(1, Number(target) || 1);
  const safeCurrent = Math.max(0, Number(current) || 0);
  const completed = safeCurrent >= safeTarget;
  const percent = Math.min(
    100,
    Math.round((Math.min(safeCurrent, safeTarget) / safeTarget) * 100)
  );

  let status = "not_started";
  if (expired && !claimed) status = "expired";
  else if (claimed) status = "claimed";
  else if (completed) status = "completed";
  else if (safeCurrent > 0) status = "in_progress";

  return {
    id: task.id,
    taskCode: task.requirements?.taskCode || task.id,
    title: task.title,
    description: task.description,
    icon: task.icon,
    rewardCoins: task.rewardCoins,
    cadence: task.cadence,
    requirements: task.requirements,
    currentProgress: Math.min(safeCurrent, safeTarget),
    targetProgress: safeTarget,
    rawProgress: safeCurrent,
    completionPercent: percent,
    completed,
    claimed,
    claimable: completed && !claimed && !expired,
    expired,
    status,
    claimKey,
    ...extra,
  };
};

const evaluateTasks = async ({
  userId,
  dateKey,
  tasks,
  claimedKeys,
  aggregates,
  nightOwlSeconds,
  streak,
}) => {
  const byId = {};
  const dailyBase = [];

  for (const task of tasks) {
    if (!taskIsWithinCampaign(task)) {
      byId[task.id] = buildProgressPayload({
        task,
        current: 0,
        target: 1,
        claimed: false,
        claimKey: dateKey,
        expired: true,
      });
      continue;
    }

    const req = task.requirements || {};
    const code = req.taskCode || task.id;
    const claimKey =
      task.cadence === "weekly"
        ? `streak:${streak.cycleStartDate || dateKey}`
        : dateKey;
    const claimed = claimedKeys.has(`${task.id}:${claimKey}`);

    let payload;

    if (code === "M01") {
      const target = Number(req.minQualifyingCalls) || 1;
      const minDur = Number(req.minCallDurationSeconds) || 60;
      const current = aggregates.calls.filter((c) => c.duration >= minDur)
        .length
        ? 1
        : 0;
      payload = buildProgressPayload({
        task,
        current,
        target,
        claimed,
        claimKey,
      });
    } else if (code === "M02") {
      const target = Number(req.minQualifyingCalls) || 3;
      const minDur = Number(req.minCallDurationSeconds) || 60;
      const current = aggregates.calls.filter(
        (c) => c.duration >= minDur
      ).length;
      payload = buildProgressPayload({
        task,
        current,
        target,
        claimed,
        claimKey,
      });
    } else if (code === "M03") {
      const target = Number(req.minCallDurationSeconds) || 300;
      payload = buildProgressPayload({
        task,
        current: aggregates.favouriteBestDuration,
        target,
        claimed,
        claimKey,
      });
    } else if (code === "M04") {
      const target = Number(req.minDurationSeconds) || 300;
      payload = buildProgressPayload({
        task,
        current: aggregates.videoDuration,
        target,
        claimed,
        claimKey,
      });
    } else if (code === "M05") {
      const target = Number(req.minDurationSeconds) || 1200;
      payload = buildProgressPayload({
        task,
        current: aggregates.totalDuration,
        target,
        claimed,
        claimKey,
      });
    } else if (code === "M06") {
      const target = Number(req.minDurationSeconds) || 300;
      payload = buildProgressPayload({
        task,
        current: nightOwlSeconds,
        target,
        claimed,
        claimKey,
      });
    } else if (code === "M08") {
      const target = Number(req.minStreakDays) || 7;
      const current = Number(streak.currentStreak) || 0;
      payload = buildProgressPayload({
        task,
        current,
        target,
        claimed,
        claimKey,
        extra: {
          streak: {
            currentStreak: current,
            lastQualifyingDate: streak.lastQualifyingDate,
            cycleStartDate: streak.cycleStartDate,
          },
        },
      });
    } else if (code === "M07") {
      // evaluated in second pass
      payload = null;
    } else {
      payload = buildProgressPayload({
        task,
        current: 0,
        target: 1,
        claimed,
        claimKey,
        expired: true,
      });
    }

    if (payload) {
      byId[task.id] = payload;
      if (["M01", "M02", "M03", "M04", "M05", "M06"].includes(code)) {
        dailyBase.push(payload);
      }
    }
  }

  for (const task of tasks) {
    const req = task.requirements || {};
    const code = req.taskCode || task.id;
    if (code !== "M07") continue;

    const claimKey = dateKey;
    const claimed = claimedKeys.has(`${task.id}:${claimKey}`);
    const prerequisiteIds = Array.isArray(req.prerequisiteTaskIds)
      ? req.prerequisiteTaskIds
      : ["M01", "M02", "M03", "M04", "M05", "M06"];
    const requireClaimed = Boolean(req.requireClaimedPrerequisites);
    const target = Number(req.minDistinctTasks) || 3;

    let count = 0;
    for (const id of prerequisiteIds) {
      const item = byId[id];
      if (!item) continue;
      if (requireClaimed) {
        if (item.claimed) count += 1;
      } else if (item.completed) {
        count += 1;
      }
    }

    byId[task.id] = buildProgressPayload({
      task,
      current: count,
      target,
      claimed,
      claimKey,
      expired: !taskIsWithinCampaign(task),
    });
  }

  return Object.values(byId).sort(
    (a, b) =>
      (tasks.find((t) => t.id === a.id)?.sortOrder || 0) -
      (tasks.find((t) => t.id === b.id)?.sortOrder || 0)
  );
};

const persistProgressSnapshot = async (userId, dateKey, taskStates) => {
  for (const item of taskStates) {
    const progressDate =
      item.cadence === "weekly"
        ? item.claimKey?.replace(/^streak:/, "") || dateKey
        : dateKey;

    let status = "in_progress";
    if (item.claimed) status = "claimed";
    else if (item.completed) status = "completed";
    else if (item.expired) status = "expired";
    else if (item.currentProgress <= 0) status = "not_started";

    await upsertProgressRow({
      userId,
      taskId: item.id,
      progressDate,
      currentProgress: item.rawProgress ?? item.currentProgress,
      targetProgress: item.targetProgress,
      status,
      completedAt: item.completed ? new Date() : null,
      claimedAt: item.claimed ? new Date() : null,
    });
  }
};

export const getMaleTaskOverview = async (userId) => {
  const numericUserId = await assertMaleUser(userId);
  await ensureMaleTaskSchema();

  const dateKey = getIndiaDateKey();
  const tasks = (await getMasterMaleTasks()).filter((task) =>
    taskIsWithinCampaign(task)
  );

  const [aggregates, claimedKeys] = await Promise.all([
    computeDayAggregates(numericUserId, dateKey),
    getClaimedTaskKeys(numericUserId),
  ]);

  const nightOwlTask = tasks.find(
    (task) => (task.requirements?.taskCode || task.id) === "M06"
  );
  const nightOwlSeconds = await computeNightOwlSeconds(
    numericUserId,
    dateKey,
    nightOwlTask?.requirements || {}
  );

  const streak = await syncMaleTaskStreak(numericUserId, {
    dateKey,
    hasQualifyingCall: aggregates.hasQualifyingCall,
  });

  const taskStates = await evaluateTasks({
    userId: numericUserId,
    dateKey,
    tasks: await getMasterMaleTasks(),
    claimedKeys,
    aggregates,
    nightOwlSeconds,
    streak,
  });

  // Persist snapshot asynchronously-safe (await for consistency)
  await persistProgressSnapshot(numericUserId, dateKey, taskStates);

  const resetsInMs = getMsUntilIstMidnight();

  return {
    activityDate: dateKey,
    timezone: "Asia/Kolkata",
    resetsInMs,
    resetsAt: new Date(Date.now() + resetsInMs).toISOString(),
    streak: {
      currentStreak: streak.currentStreak,
      lastQualifyingDate: streak.lastQualifyingDate,
      cycleStartDate: streak.cycleStartDate,
      target: 7,
    },
    stats: {
      qualifyingCalls: aggregates.qualifyingCallCount,
      totalDurationSeconds: aggregates.totalDuration,
      videoDurationSeconds: aggregates.videoDuration,
      favouriteBestDurationSeconds: aggregates.favouriteBestDuration,
      nightOwlSeconds,
    },
    tasks: taskStates,
    dailyTasks: taskStates.filter((task) => task.cadence === "daily"),
    weeklyTasks: taskStates.filter((task) => task.cadence === "weekly"),
  };
};

export const getMaleTaskSummary = async (userId) => {
  const overview = await getMaleTaskOverview(userId);
  const tasks = overview.tasks || [];

  const completedTasks = tasks.filter((task) => task.completed).length;
  const claimedRewards = tasks.filter((task) => task.claimed).length;
  const claimableRewards = tasks.filter((task) => task.claimable).length;

  await ensureClaimsTable();
  const [totalRow] = await sequelize.query(
    `SELECT COALESCE(SUM(rewardCoins), 0) AS totalBonusCoins
     FROM male_task_claims
     WHERE userId = :userId`,
    {
      replacements: { userId: Number(userId) },
      type: QueryTypes.SELECT,
    }
  );

  return {
    activityDate: overview.activityDate,
    timezone: overview.timezone,
    resetsInMs: overview.resetsInMs,
    resetsAt: overview.resetsAt,
    totalAvailableTasks: tasks.filter((task) => !task.expired).length,
    completedTasks,
    claimedRewards,
    claimableRewards,
    totalBonusCoinsEarned: Number(totalRow?.totalBonusCoins) || 0,
    currentWeeklyStreak: overview.streak?.currentStreak || 0,
    streak: overview.streak,
  };
};

export const getMaleTaskHistory = async (
  userId,
  { limit = 50 } = {}
) => {
  const numericUserId = await assertMaleUser(userId);
  await ensureClaimsTable();
  await ensureMasterTasksTable();

  const rows = await sequelize.query(
    `SELECT
       c.id,
       c.userId,
       c.taskId,
       c.claimKey,
       c.rewardCoins,
       c.walletTransactionId,
       c.createdAt,
       t.title AS taskTitle,
       t.cadence AS taskCadence,
       t.icon AS taskIcon
     FROM male_task_claims c
     LEFT JOIN male_master_tasks t ON t.id = c.taskId
     WHERE c.userId = :userId
     ORDER BY c.createdAt DESC
     LIMIT :limit`,
    {
      replacements: {
        userId: numericUserId,
        limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
      },
      type: QueryTypes.SELECT,
    }
  );

  return {
    rows: rows.map((row) => ({
      id: Number(row.id),
      taskId: row.taskId,
      taskTitle: row.taskTitle || row.taskId,
      taskCadence: row.taskCadence || "daily",
      taskIcon: row.taskIcon || null,
      claimKey: row.claimKey,
      rewardCoins: Number(row.rewardCoins) || 0,
      walletTransactionId: row.walletTransactionId
        ? Number(row.walletTransactionId)
        : null,
      claimedAt: row.createdAt,
    })),
  };
};

export const claimMaleTaskReward = async (userId, taskId) => {
  const numericUserId = await assertMaleUser(userId);

  if (!taskId) {
    throw new Error("taskId is required");
  }

  const task = await getMaleTaskDefinition(taskId);
  if (!task || !task.active || task.deletedAt) {
    throw new Error("Task not found");
  }

  if (!taskIsWithinCampaign(task)) {
    throw new Error("Task is not available");
  }

  const overview = await getMaleTaskOverview(numericUserId);
  const taskState = overview.tasks.find((item) => item.id === taskId);

  if (!taskState) {
    throw new Error("Task not found");
  }

  if (taskState.claimed) {
    throw new Error("Reward already claimed");
  }

  if (!taskState.claimable) {
    throw new Error("Task requirements not completed yet");
  }

  const claimKey = taskState.claimKey;
  await ensureClaimsTable();

  const transaction = await sequelize.transaction();

  try {
    await sequelize.query(
      `INSERT INTO male_task_claims
        (userId, taskId, claimKey, rewardCoins)
       VALUES
        (:userId, :taskId, :claimKey, :rewardCoins)`,
      {
        replacements: {
          userId: numericUserId,
          taskId,
          claimKey,
          rewardCoins: task.rewardCoins,
        },
        type: QueryTypes.INSERT,
        transaction,
      }
    );

    let wallet = await Wallet.findOne({
      where: { userId: numericUserId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!wallet) {
      wallet = await Wallet.create(
        { userId: numericUserId, balance: 0 },
        { transaction }
      );
    }

    wallet.balance =
      Number(wallet.balance ?? 0) + Number(task.rewardCoins || 0);
    await wallet.save({ transaction });

    const walletTx = await WalletTransaction.create(
      {
        userId: numericUserId,
        type: WALLET_TX_TYPE,
        amount: task.rewardCoins,
        description: `Male task reward: ${task.title}`,
        referenceType: WALLET_REF_TYPE,
        referenceId: null,
      },
      { transaction }
    );

    await sequelize.query(
      `UPDATE male_task_claims
       SET walletTransactionId = :walletTransactionId
       WHERE userId = :userId
         AND taskId = :taskId
         AND claimKey = :claimKey`,
      {
        replacements: {
          walletTransactionId: walletTx.id,
          userId: numericUserId,
          taskId,
          claimKey,
        },
        transaction,
      }
    );

    const progressDate =
      task.cadence === "weekly"
        ? String(claimKey).replace(/^streak:/, "")
        : overview.activityDate;

    await upsertProgressRow({
      userId: numericUserId,
      taskId,
      progressDate,
      currentProgress: taskState.rawProgress ?? taskState.currentProgress,
      targetProgress: taskState.targetProgress,
      status: "claimed",
      completedAt: new Date(),
      claimedAt: new Date(),
      transaction,
    });

    // After weekly streak claim, start a fresh cycle on the next qualifying day.
    if ((task.requirements?.taskCode || task.id) === "M08") {
      await sequelize.query(
        `UPDATE male_task_streaks
         SET currentStreak = 0,
             cycleStartDate = NULL,
             updatedAt = CURRENT_TIMESTAMP
         WHERE userId = :userId`,
        {
          replacements: { userId: numericUserId },
          transaction,
        }
      );
    }

    await transaction.commit();

    return {
      success: true,
      taskId,
      rewardCoins: task.rewardCoins,
      walletBalance: wallet.balance,
      taskTitle: task.title,
      claimKey,
      walletTransactionId: walletTx.id,
      message: "Task reward claimed successfully",
    };
  } catch (error) {
    await transaction.rollback();

    if (
      String(error?.message ?? "").includes("unique_male_task_claim") ||
      String(error?.original?.code ?? "") === "ER_DUP_ENTRY"
    ) {
      throw new Error("Reward already claimed");
    }

    throw error;
  }
};

export const listMaleTaskClaims = async ({
  date,
  taskId,
  cadence = "daily",
  search = "",
  limit = 500,
} = {}) => {
  await ensureClaimsTable();
  await ensureMasterTasksTable();

  const normalizedCadence = String(cadence || "daily")
    .trim()
    .toLowerCase();
  const claimDate = String(date || getIndiaDateKey()).trim();
  const whereParts = ["1 = 1"];
  const replacements = {
    limit: Math.min(Math.max(Number(limit) || 500, 1), 1000),
  };

  if (normalizedCadence === "daily") {
    whereParts.push("c.claimKey = :claimKey");
    replacements.claimKey = claimDate;
  } else if (normalizedCadence === "weekly") {
    whereParts.push("c.claimKey LIKE 'streak:%'");
    if (claimDate) {
      whereParts.push(
        "(c.claimKey = :streakKey OR DATE(CONVERT_TZ(c.createdAt, '+00:00', '+05:30')) = :claimDate)"
      );
      replacements.streakKey = `streak:${claimDate}`;
      replacements.claimDate = claimDate;
    }
  } else if (normalizedCadence === "all" && claimDate) {
    // Daily claimKey + weekly streak key + same IST calendar day
    whereParts.push(
      `(c.claimKey = :claimKey OR c.claimKey = :streakKey OR DATE(CONVERT_TZ(c.createdAt, '+00:00', '+05:30')) = :claimDate)`
    );
    replacements.claimKey = claimDate;
    replacements.streakKey = `streak:${claimDate}`;
    replacements.claimDate = claimDate;
  } else if (claimDate) {
    whereParts.push("c.claimKey = :claimKey");
    replacements.claimKey = claimDate;
  }

  if (taskId) {
    whereParts.push("c.taskId = :taskId");
    replacements.taskId = taskId;
  }

  const rows = await sequelize.query(
    `SELECT
       c.id,
       c.userId,
       c.taskId,
       c.claimKey,
       c.rewardCoins,
       c.walletTransactionId,
       c.createdAt,
       u.name,
       u.nickname,
       u.username,
       u.phone,
       u.publicUserId,
       t.title AS taskTitle,
       t.cadence AS taskCadence
     FROM male_task_claims c
     JOIN users u ON u.id = c.userId
     LEFT JOIN male_master_tasks t ON t.id = c.taskId
     WHERE ${whereParts.join(" AND ")}
     ORDER BY c.createdAt DESC
     LIMIT :limit`,
    {
      replacements,
      type: QueryTypes.SELECT,
    }
  );

  const getDisplayName = (row) =>
    row.nickname ||
    (row.name && row.name !== "New User" ? row.name : null) ||
    row.username ||
    row.publicUserId ||
    row.phone ||
    `User ${row.userId}`;

  let mapped = rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.userId),
    displayName: getDisplayName(row),
    phone: row.phone || "—",
    publicUserId: row.publicUserId || "",
    taskId: row.taskId,
    taskTitle: row.taskTitle || row.taskId,
    taskCadence:
      row.taskCadence ||
      (String(row.claimKey || "").startsWith("streak:") ? "weekly" : "daily"),
    claimKey: row.claimKey,
    rewardCoins: Number(row.rewardCoins) || 0,
    walletTransactionId: row.walletTransactionId
      ? Number(row.walletTransactionId)
      : null,
    claimedAt: row.createdAt,
  }));

  if (search) {
    const query = search.toLowerCase();
    const compact = query.replace(/[^a-z0-9]/g, "");

    mapped = mapped.filter((row) => {
      const values = [
        row.displayName,
        row.phone,
        row.publicUserId,
        row.taskId,
        row.taskTitle,
        String(row.userId),
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return values.some((value) => {
        const compactValue = value.replace(/[^a-z0-9]/g, "");
        return (
          value.includes(query) ||
          (compact && compactValue.includes(compact))
        );
      });
    });
  }

  const tasks = await getMasterMaleTasks({
    includeInactive: true,
    includeDeleted: true,
  });

  const uniqueUsers = new Set(mapped.map((row) => row.userId)).size;
  const totalRewardCoins = mapped.reduce(
    (sum, row) => sum + Number(row.rewardCoins || 0),
    0
  );

  // Simple suspicious heuristic: same user claimed >= 6 rewards in the result set day
  const claimsByUser = new Map();
  for (const row of mapped) {
    claimsByUser.set(row.userId, (claimsByUser.get(row.userId) || 0) + 1);
  }
  const suspiciousUserIds = [...claimsByUser.entries()]
    .filter(([, count]) => count >= 6)
    .map(([id]) => id);

  return {
    summary: {
      totalClaims: mapped.length,
      uniqueUsers,
      totalRewardCoins,
      claimDate: claimDate,
      cadence: normalizedCadence,
      taskId: taskId || null,
      suspiciousUserCount: suspiciousUserIds.length,
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      cadence: task.cadence,
    })),
    rows: mapped.map((row) => ({
      ...row,
      suspicious: suspiciousUserIds.includes(row.userId),
    })),
  };
};

/**
 * Optional post-settlement hook: refresh streak / notify without trusting sockets.
 */
export const onMaleCallSettledForTasks = async (callRecord) => {
  try {
    const callerId = Number(callRecord?.callerId);
    if (!Number.isFinite(callerId) || callerId <= 0) return null;

    const user = await User.findByPk(callerId, { attributes: ["id", "gender"] });
    if (!user || !isMaleUser(user)) return null;

    const duration = Number(callRecord?.duration ?? 0);
    const hasQualifyingCall =
      String(callRecord?.status || "") === "completed" &&
      Boolean(callRecord?.acceptedAt) &&
      Boolean(callRecord?.settledAt) &&
      duration >= 60 &&
      Number(callRecord.callerId) !== Number(callRecord.receiverId);

    if (!hasQualifyingCall) return null;

    const dateKey = getIndiaDateKey(
      callRecord.acceptedAt ? new Date(callRecord.acceptedAt) : new Date()
    );

    await syncMaleTaskStreak(callerId, {
      dateKey,
      hasQualifyingCall: true,
    });

    return { userId: callerId, dateKey };
  } catch (error) {
    console.warn("[maleTask] onMaleCallSettledForTasks failed", error?.message);
    return null;
  }
};
