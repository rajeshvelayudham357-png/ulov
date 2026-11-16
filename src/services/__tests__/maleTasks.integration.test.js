/**
 * Male daily task eligibility, claims, streak, admin CRUD.
 * Writes only ids >= 887100. Run against DB_NAME=ulov_billing_test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { QueryTypes } from "sequelize";

import { sequelize } from "../../config/database.js";
import {
  CallHistory,
  Favorite,
  Wallet,
  WalletTransaction,
} from "../../models/index.js";
import {
  claimMaleTaskReward,
  createMasterMaleTask,
  deleteMasterMaleTask,
  ensureMaleTaskSchema,
  getMaleTaskHistory,
  getMaleTaskOverview,
  getMaleTaskSummary,
  getMasterMaleTasks,
  listMaleTaskClaims,
  syncMaleTaskStreak,
  updateMasterMaleTask,
} from "../maleTask.service.js";
import {
  getIndiaDateKey,
  getIstDayBounds,
  getNightOwlWindowBounds,
  getPreviousIndiaDateKey,
} from "../maleTaskDuration.util.js";
import { upsertTestUser, upsertTestWallet } from "./helpers/qcTestHarness.js";

const PREFIX = 887100;
const MALE = PREFIX + 1;
const CREATOR = PREFIX + 2;
const CREATOR_B = PREFIX + 3;
const FEMALE_USER = PREFIX + 4;
const IDS = [MALE, CREATOR, CREATOR_B, FEMALE_USER];

const today = () => getIndiaDateKey();

const cleanup = async () => {
  await ensureMaleTaskSchema();
  await sequelize.query(
    "DELETE FROM male_task_claims WHERE userId IN (:ids)",
    { replacements: { ids: IDS } }
  );
  await sequelize.query(
    "DELETE FROM male_task_progress WHERE userId IN (:ids)",
    { replacements: { ids: IDS } }
  );
  await sequelize.query(
    "DELETE FROM male_task_streaks WHERE userId IN (:ids)",
    { replacements: { ids: IDS } }
  );
  await Favorite.destroy({ where: { userId: IDS } });
  await CallHistory.destroy({
    where: { callerId: IDS },
  });
  await CallHistory.destroy({
    where: { receiverId: IDS },
  });
  await WalletTransaction.destroy({ where: { userId: IDS } });
  await Wallet.destroy({ where: { userId: IDS } });
  await sequelize.query("DELETE FROM users WHERE id IN (:ids)", {
    replacements: { ids: IDS },
  });
  await sequelize.query(
    "DELETE FROM male_master_tasks WHERE id LIKE 'ZZ_MALE_%' OR id LIKE 'zz_male_%'"
  );
};

const makeSettledCall = async ({
  callerId = MALE,
  receiverId = CREATOR,
  type = "voice",
  durationSeconds = 60,
  acceptedAt = new Date(),
  endedAt = null,
  status = "completed",
} = {}) => {
  const accept = new Date(acceptedAt);
  const end =
    endedAt != null
      ? new Date(endedAt)
      : new Date(accept.getTime() + durationSeconds * 1000);

  return CallHistory.create({
    callerId,
    receiverId,
    type,
    duration: durationSeconds,
    status,
    acceptedAt: accept,
    endedAt: end,
    settledAt: end,
    coinsSpent: Math.max(1, Math.ceil(durationSeconds / 60) * 10),
    collectedCoins: Math.max(1, Math.ceil(durationSeconds / 60) * 10),
  });
};

const balanceOf = async (userId) =>
  Number((await Wallet.findOne({ where: { userId } }))?.balance ?? 0);

const taskById = (overview, id) =>
  overview.tasks.find((task) => task.id === id);

test.before(async () => {
  await cleanup();
  await upsertTestUser({ id: MALE, gender: "Male", nickname: "Male Tasks" });
  await upsertTestUser({
    id: CREATOR,
    gender: "Female",
    nickname: "Creator A",
  });
  await upsertTestUser({
    id: CREATOR_B,
    gender: "Female",
    nickname: "Creator B",
  });
  await upsertTestUser({
    id: FEMALE_USER,
    gender: "Female",
    nickname: "Female Not Male",
  });
  await upsertTestWallet(MALE, 100);
});

test.after(async () => {
  await cleanup();
  await sequelize.close();
});

test("seeds M01–M08 master tasks", async () => {
  const tasks = await getMasterMaleTasks();
  const ids = tasks.map((task) => task.id);
  for (const id of ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("female users cannot load male tasks", async () => {
  await assert.rejects(
    () => getMaleTaskOverview(FEMALE_USER),
    /male users only/i
  );
});

test("59s call does not qualify; 60s does for M01", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  await makeSettledCall({ durationSeconds: 59 });
  let overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M01").completed, false);
  assert.equal(taskById(overview, "M01").currentProgress, 0);

  await makeSettledCall({ durationSeconds: 60, receiverId: CREATOR_B });
  overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M01").completed, true);
  assert.equal(taskById(overview, "M01").claimable, true);
});

test("missed / rejected / unsettled calls never count", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });

  await CallHistory.create({
    callerId: MALE,
    receiverId: CREATOR,
    type: "voice",
    duration: 120,
    status: "missed",
    acceptedAt: null,
    settledAt: null,
  });
  await CallHistory.create({
    callerId: MALE,
    receiverId: CREATOR,
    type: "voice",
    duration: 120,
    status: "rejected",
    acceptedAt: null,
    settledAt: null,
  });
  await CallHistory.create({
    callerId: MALE,
    receiverId: CREATOR,
    type: "voice",
    duration: 300,
    status: "completed",
    acceptedAt: new Date(),
    endedAt: new Date(),
    settledAt: null,
  });
  await makeSettledCall({
    callerId: MALE,
    receiverId: MALE,
    durationSeconds: 300,
  });

  const overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M01").completed, false);
  assert.equal(overview.stats.qualifyingCalls, 0);
});

test("M02 needs 3 qualifying sessions; same creator allowed", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  await makeSettledCall({ durationSeconds: 60 });
  await makeSettledCall({ durationSeconds: 60 });
  let overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M02").currentProgress, 2);
  assert.equal(taskById(overview, "M02").completed, false);

  await makeSettledCall({ durationSeconds: 60 });
  overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M02").completed, true);
});

test("M03 requires favourite before accept and 300s", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  await Favorite.destroy({ where: { userId: MALE } });

  const accept = new Date();
  await makeSettledCall({ durationSeconds: 300, acceptedAt: accept });
  let overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M03").completed, false);

  // Favourite after the call — still fails
  await Favorite.create({
    userId: MALE,
    favoriteUserId: CREATOR,
    createdAt: new Date(accept.getTime() + 60_000),
    updatedAt: new Date(accept.getTime() + 60_000),
  });
  overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M03").completed, false);

  await Favorite.destroy({ where: { userId: MALE } });
  await Favorite.create({
    userId: MALE,
    favoriteUserId: CREATOR,
    createdAt: new Date(accept.getTime() - 60_000),
    updatedAt: new Date(accept.getTime() - 60_000),
  });
  overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M03").completed, true);
});

test("M04 counts only video duration; M05 counts all", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  await makeSettledCall({ type: "voice", durationSeconds: 200 });
  await makeSettledCall({
    type: "video",
    durationSeconds: 200,
    receiverId: CREATOR_B,
  });

  const overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M04").currentProgress, 200);
  assert.equal(taskById(overview, "M04").completed, false);
  assert.equal(taskById(overview, "M05").currentProgress, 400);

  await makeSettledCall({ type: "video", durationSeconds: 100 });
  const next = await getMaleTaskOverview(MALE);
  assert.equal(taskById(next, "M04").completed, true);
});

test("M05 completes at 1200s boundary", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  await makeSettledCall({ durationSeconds: 1199 });
  let overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M05").completed, false);

  await makeSettledCall({ durationSeconds: 1, receiverId: CREATOR_B });
  overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M05").completed, true);
});

test("M06 Night Owl clips midnight-spanning calls", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  const dateKey = today();
  const { start } = getNightOwlWindowBounds(dateKey);

  // 10 minutes fully in window
  await makeSettledCall({
    durationSeconds: 600,
    acceptedAt: new Date(start.getTime() + 10 * 60 * 1000),
  });

  // Spans midnight: 23:50 → 00:20 → 10 minutes in window
  const almostMidnight = new Date(
    getIstDayBounds(dateKey).start.getTime() + 23 * 60 * 60 * 1000 + 50 * 60 * 1000
  );
  await makeSettledCall({
    durationSeconds: 1800,
    acceptedAt: almostMidnight,
    endedAt: new Date(almostMidnight.getTime() + 30 * 60 * 1000),
    receiverId: CREATOR_B,
  });

  const overview = await getMaleTaskOverview(MALE);
  // 600 + 600 (10 min until midnight) = 1200
  assert.ok(taskById(overview, "M06").rawProgress >= 300);
  assert.equal(taskById(overview, "M06").completed, true);
});

test("M07 completes when 3 of M01–M06 are done without requiring claims", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  await Favorite.destroy({ where: { userId: MALE } });
  await sequelize.query(
    "DELETE FROM male_task_claims WHERE userId = :userId",
    { replacements: { userId: MALE } }
  );

  // M01 + M02 via 3×60s, M04 via 300s video
  await makeSettledCall({ durationSeconds: 60 });
  await makeSettledCall({ durationSeconds: 60, receiverId: CREATOR_B });
  await makeSettledCall({ durationSeconds: 60 });
  await makeSettledCall({ type: "video", durationSeconds: 300 });

  const overview = await getMaleTaskOverview(MALE);
  assert.equal(taskById(overview, "M01").completed, true);
  assert.equal(taskById(overview, "M02").completed, true);
  assert.equal(taskById(overview, "M04").completed, true);
  assert.equal(taskById(overview, "M07").completed, true);
  assert.equal(taskById(overview, "M07").claimable, true);
});

test("claim credits wallet once; duplicate claim is rejected", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  await sequelize.query(
    "DELETE FROM male_task_claims WHERE userId = :userId",
    { replacements: { userId: MALE } }
  );
  await WalletTransaction.destroy({
    where: { userId: MALE, type: "male_task_reward" },
  });
  await upsertTestWallet(MALE, 100);

  await makeSettledCall({ durationSeconds: 60 });
  const before = await balanceOf(MALE);
  const result = await claimMaleTaskReward(MALE, "M01");
  assert.equal(result.success, true);
  assert.equal(result.rewardCoins, 10);
  assert.equal(await balanceOf(MALE), before + 10);

  const txs = await WalletTransaction.findAll({
    where: { userId: MALE, type: "male_task_reward" },
  });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].referenceType, "male_task");

  await assert.rejects(
    () => claimMaleTaskReward(MALE, "M01"),
    /already claimed/i
  );
  assert.equal(await balanceOf(MALE), before + 10);

  const history = await getMaleTaskHistory(MALE);
  assert.ok(history.rows.some((row) => row.taskId === "M01"));

  const summary = await getMaleTaskSummary(MALE);
  assert.ok(summary.totalBonusCoinsEarned >= 10);
  assert.ok(summary.claimedRewards >= 1);
});

test("concurrent claims do not double-credit", async () => {
  await CallHistory.destroy({ where: { callerId: MALE } });
  await sequelize.query(
    "DELETE FROM male_task_claims WHERE userId = :userId AND taskId = 'M02'",
    { replacements: { userId: MALE } }
  );
  await makeSettledCall({ durationSeconds: 60 });
  await makeSettledCall({ durationSeconds: 60 });
  await makeSettledCall({ durationSeconds: 60 });

  await upsertTestWallet(MALE, 500);
  const before = await balanceOf(MALE);

  const results = await Promise.allSettled([
    claimMaleTaskReward(MALE, "M02"),
    claimMaleTaskReward(MALE, "M02"),
    claimMaleTaskReward(MALE, "M02"),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 2);
  assert.equal(await balanceOf(MALE), before + 15);
});

test("disabled task cannot be claimed", async () => {
  const original = (await getMasterMaleTasks({ includeInactive: true })).find(
    (task) => task.id === "M01"
  );
  await updateMasterMaleTask("M01", { active: false });
  await CallHistory.destroy({ where: { callerId: MALE } });
  await sequelize.query(
    "DELETE FROM male_task_claims WHERE userId = :userId AND taskId = 'M01'",
    { replacements: { userId: MALE } }
  );
  await makeSettledCall({ durationSeconds: 120 });

  await assert.rejects(() => claimMaleTaskReward(MALE, "M01"), /not found/i);

  await updateMasterMaleTask("M01", {
    active: true,
    rewardCoins: original.rewardCoins,
  });
});

test("admin can edit male task rewards without changing past claims", async () => {
  const task = await createMasterMaleTask({
    title: "ZZ Male Temp Task",
    description: "temp",
    rewardCoins: 5,
    cadence: "daily",
    requirements: { taskCode: "ZZ", requirementType: "qualifying_call_count", minQualifyingCalls: 99 },
  });

  const updated = await updateMasterMaleTask(task.id, {
    rewardCoins: 50,
    requirements: {
      taskCode: "ZZ",
      requirementType: "qualifying_call_count",
      minQualifyingCalls: 2,
      minCallDurationSeconds: 60,
    },
  });
  assert.equal(updated.rewardCoins, 50);

  await deleteMasterMaleTask(task.id);
  const listed = await getMasterMaleTasks({ includeInactive: true });
  assert.ok(!listed.some((row) => row.id === task.id));
});

test("weekly streak advances on consecutive days and resets on miss", async () => {
  const dateKey = today();
  const yesterday = getPreviousIndiaDateKey(dateKey);
  const twoDaysAgo = getPreviousIndiaDateKey(yesterday);

  await sequelize.query(
    `INSERT INTO male_task_streaks
      (userId, currentStreak, lastQualifyingDate, cycleStartDate)
     VALUES (:userId, 2, :twoDaysAgo, :twoDaysAgo)
     ON DUPLICATE KEY UPDATE
       currentStreak = 2,
       lastQualifyingDate = :twoDaysAgo,
       cycleStartDate = :twoDaysAgo`,
    {
      replacements: { userId: MALE, twoDaysAgo },
    }
  );

  // Missed yesterday → reset then start at 1 today
  let streak = await syncMaleTaskStreak(MALE, {
    dateKey,
    hasQualifyingCall: true,
  });
  assert.equal(streak.currentStreak, 1);
  assert.equal(streak.cycleStartDate, dateKey);

  await sequelize.query(
    `UPDATE male_task_streaks
     SET currentStreak = 3,
         lastQualifyingDate = :yesterday,
         cycleStartDate = :yesterday
     WHERE userId = :userId`,
    { replacements: { userId: MALE, yesterday } }
  );

  streak = await syncMaleTaskStreak(MALE, {
    dateKey,
    hasQualifyingCall: true,
  });
  assert.equal(streak.currentStreak, 4);
});

test("M08 claimable after 7-day streak and claim resets cycle", async () => {
  const dateKey = today();
  await sequelize.query(
    "DELETE FROM male_task_claims WHERE userId = :userId AND taskId = 'M08'",
    { replacements: { userId: MALE } }
  );
  await CallHistory.destroy({ where: { callerId: MALE } });
  await makeSettledCall({ durationSeconds: 60 });

  const cycleStart = getPreviousIndiaDateKey(
    getPreviousIndiaDateKey(
      getPreviousIndiaDateKey(
        getPreviousIndiaDateKey(
          getPreviousIndiaDateKey(getPreviousIndiaDateKey(dateKey))
        )
      )
    )
  );

  await sequelize.query(
    `INSERT INTO male_task_streaks
      (userId, currentStreak, lastQualifyingDate, cycleStartDate)
     VALUES (:userId, 6, :yesterday, :cycleStart)
     ON DUPLICATE KEY UPDATE
       currentStreak = 6,
       lastQualifyingDate = :yesterday,
       cycleStartDate = :cycleStart`,
    {
      replacements: {
        userId: MALE,
        yesterday: getPreviousIndiaDateKey(dateKey),
        cycleStart,
      },
    }
  );

  const overview = await getMaleTaskOverview(MALE);
  const m08 = taskById(overview, "M08");
  assert.equal(m08.currentProgress, 7);
  assert.equal(m08.completed, true);
  assert.equal(m08.claimable, true);

  const before = await balanceOf(MALE);
  const result = await claimMaleTaskReward(MALE, "M08");
  assert.equal(result.rewardCoins, 100);
  assert.equal(await balanceOf(MALE), before + 100);

  const [streakRow] = await sequelize.query(
    `SELECT currentStreak, cycleStartDate FROM male_task_streaks WHERE userId = :userId`,
    { replacements: { userId: MALE }, type: QueryTypes.SELECT }
  );
  assert.equal(Number(streakRow.currentStreak), 0);
  assert.equal(streakRow.cycleStartDate, null);

  await assert.rejects(
    () => claimMaleTaskReward(MALE, "M08"),
    /not completed|already claimed/i
  );
});

test("admin claims listing returns bonus totals", async () => {
  const result = await listMaleTaskClaims({
    date: today(),
    cadence: "daily",
  });
  assert.ok(result.summary);
  assert.ok(Array.isArray(result.rows));
  assert.ok(Array.isArray(result.tasks));
});
