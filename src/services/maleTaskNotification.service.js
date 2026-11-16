import { getIndiaDateKey } from "./maleTaskDuration.util.js";
import { notifyMaleDailyTaskEvent } from "./notificationPush.service.js";

const recentNotices = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;

const noticeKey = (userId, kind, dateKey, taskId = "") =>
  `${userId}:${kind}:${dateKey}:${taskId}`;

const wasRecentlyNotified = (key, ttlMs = DAY_MS) => {
  const last = recentNotices.get(key);
  return Boolean(last && Date.now() - last < ttlMs);
};

const markNotified = (key) => {
  recentNotices.set(key, Date.now());
  // Prevent unbounded growth
  if (recentNotices.size > 5000) {
    const cutoff = Date.now() - DAY_MS;
    for (const [entryKey, ts] of recentNotices.entries()) {
      if (ts < cutoff) recentNotices.delete(entryKey);
    }
  }
};

/**
 * Side-effect notifications when a male opens the task overview.
 * At most one daily reminder + one completion notice per task per IST day.
 */
export const maybeNotifyMaleTaskOverview = async (userId, overview) => {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0 || !overview) {
    return;
  }

  const dateKey = overview.activityDate || getIndiaDateKey();
  const tasks = Array.isArray(overview.tasks) ? overview.tasks : [];

  const reminderKey = noticeKey(numericUserId, "daily_reminder", dateKey);
  if (!wasRecentlyNotified(reminderKey)) {
    const hasOpen = tasks.some(
      (task) => !task.claimed && !task.expired && task.cadence === "daily"
    );
    if (hasOpen) {
      markNotified(reminderKey);
      await notifyMaleDailyTaskEvent({
        userId: numericUserId,
        kind: "male_task_reminder",
        title: "Your ULOV Daily Tasks are ready!",
        body: "Complete calls and earn free bonus coins!",
        data: { screen: "/tabs/daily-tasks" },
      });
    }
  }

  for (const task of tasks) {
    if (!task.claimable || task.claimed) continue;
    const completedKey = noticeKey(
      numericUserId,
      "task_completed",
      dateKey,
      task.id
    );
    if (wasRecentlyNotified(completedKey)) continue;
    markNotified(completedKey);
    await notifyMaleDailyTaskEvent({
      userId: numericUserId,
      kind: "male_task_completed",
      taskId: task.id,
      rewardCoins: task.rewardCoins,
      title: "Task completed!",
      body: `Congratulations! You've unlocked ${task.rewardCoins} bonus coins. Claim them from the Task Page!`,
      data: { screen: "/tabs/daily-tasks", taskId: String(task.id) },
    });
  }

  const streak = overview.streak?.currentStreak || 0;
  if (streak === 6) {
    const streakKey = noticeKey(numericUserId, "streak_almost", dateKey);
    if (!wasRecentlyNotified(streakKey)) {
      markNotified(streakKey);
      await notifyMaleDailyTaskEvent({
        userId: numericUserId,
        kind: "male_task_streak",
        title: "Weekly streak almost done!",
        body: "You're one day away from your 100-coin streak reward!",
        data: { screen: "/tabs/daily-tasks" },
      });
    }
  }
};
