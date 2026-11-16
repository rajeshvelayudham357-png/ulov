/**
 * Seed definitions for male daily / weekly call tasks (M01–M08).
 * Runtime values live in male_master_tasks; INSERT IGNORE preserves admin edits.
 */
export const MALE_TASK_DEFINITIONS = [
  {
    id: "M01",
    title: "First Call",
    description: "Complete your first 1-minute call today.",
    icon: "gift",
    rewardCoins: 10,
    cadence: "daily",
    requirements: {
      taskCode: "M01",
      requirementType: "qualifying_call_count",
      minQualifyingCalls: 1,
      minCallDurationSeconds: 60,
    },
  },
  {
    id: "M02",
    title: "Daily Caller",
    description: "Complete 3 qualifying calls of at least 1 minute each.",
    icon: "phone",
    rewardCoins: 15,
    cadence: "daily",
    requirements: {
      taskCode: "M02",
      requirementType: "qualifying_call_count",
      minQualifyingCalls: 3,
      minCallDurationSeconds: 60,
    },
  },
  {
    id: "M03",
    title: "Favourite Creator",
    description: "Complete a 5-minute call with a creator you favourited before the call.",
    icon: "heart",
    rewardCoins: 20,
    cadence: "daily",
    requirements: {
      taskCode: "M03",
      requirementType: "favourite_call_duration",
      minCallDurationSeconds: 300,
    },
  },
  {
    id: "M04",
    title: "Video Explorer",
    description: "Complete 5 minutes of video calling today.",
    icon: "video",
    rewardCoins: 25,
    cadence: "daily",
    requirements: {
      taskCode: "M04",
      requirementType: "video_duration",
      minDurationSeconds: 300,
    },
  },
  {
    id: "M05",
    title: "Call Marathon",
    description: "Complete 20 minutes of voice or video calls today.",
    icon: "fire",
    rewardCoins: 40,
    cadence: "daily",
    requirements: {
      taskCode: "M05",
      requirementType: "total_duration",
      minDurationSeconds: 1200,
    },
  },
  {
    id: "M06",
    title: "Night Owl",
    description: "Complete 5 minutes of calling between 9 PM and midnight.",
    icon: "moon",
    rewardCoins: 15,
    cadence: "daily",
    requirements: {
      taskCode: "M06",
      requirementType: "night_owl_duration",
      minDurationSeconds: 300,
      windowStartHour: 21,
      windowEndHour: 24,
    },
  },
  {
    id: "M07",
    title: "Daily Challenge",
    description: "Complete any 3 different daily tasks today.",
    icon: "target",
    rewardCoins: 30,
    cadence: "daily",
    requirements: {
      taskCode: "M07",
      requirementType: "daily_challenge",
      minDistinctTasks: 3,
      prerequisiteTaskIds: ["M01", "M02", "M03", "M04", "M05", "M06"],
      requireClaimedPrerequisites: false,
    },
  },
  {
    id: "M08",
    title: "Weekly Streak",
    description: "Make at least 1 qualifying call daily for 7 consecutive days.",
    icon: "trophy",
    rewardCoins: 100,
    cadence: "weekly",
    requirements: {
      taskCode: "M08",
      requirementType: "weekly_streak",
      minStreakDays: 7,
      minCallDurationSeconds: 60,
    },
  },
];

export const getMaleTaskSeedDefinition = (taskId) =>
  MALE_TASK_DEFINITIONS.find((task) => task.id === taskId);
