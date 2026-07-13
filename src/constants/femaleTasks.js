export const FEMALE_TASK_DEFINITIONS = [
  {
    id: "daily_starter",
    title: "Daily Login + Video Call",
    description:
      "Login today and complete 1 video call of at least 1 minute",
    rewardCoins: 10,
    cadence: "daily",
    requirements: {
      loggedIn: true,
      minVideoCallsOneMinute: 1,
    },
  },
  {
    id: "daily_active_5h",
    title: "5 Hour Creator",
    description:
      "Stay online for 5 hours and complete 20 calls today",
    rewardCoins: 50,
    cadence: "daily",
    requirements: {
      minOnlineMinutes: 300,
      minCalls: 20,
    },
  },
  {
    id: "daily_super_12h",
    title: "12 Hour Super Creator",
    description:
      "Stay online for 12+ hours and complete 50+ calls today",
    rewardCoins: 100,
    cadence: "daily",
    requirements: {
      minOnlineMinutes: 720,
      minCalls: 50,
    },
  },
  {
    id: "daily_gold_5k",
    title: "Daily Gold Milestone",
    description: "Earn 5,000 gold coins in a single day",
    rewardCoins: 200,
    cadence: "daily",
    requirements: {
      minGoldEarnedToday: 5000,
    },
  },
  {
    id: "lifetime_gold_50k",
    title: "50K Gold Club",
    description: "Reach 50,000 total gold coins earned",
    rewardCoins: 500,
    cadence: "lifetime",
    requirements: {
      minTotalGold: 50000,
    },
  },
  {
    id: "lifetime_gold_100k",
    title: "1 Lakh Gold Legend",
    description: "Reach 1,00,000 total gold coins earned",
    rewardCoins: 2000,
    cadence: "lifetime",
    requirements: {
      minTotalGold: 100000,
    },
  },
];

export const getFemaleTaskDefinition =
(taskId)=>
FEMALE_TASK_DEFINITIONS.find(
(task)=>task.id === taskId
);
