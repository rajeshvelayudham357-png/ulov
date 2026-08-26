import { QueryTypes } from "sequelize";
import { Op } from "sequelize";

import {
FEMALE_TASK_DEFINITIONS,
} from "../constants/femaleTasks.js";
import { sequelize } from "../config/database.js";
import {
getFemaleOnlineTimeStats,
recordFemaleDailyLogin,
recordFemaleOnlineHeartbeat
} from "../services/femaleOnlineTime.service.js";
import {
CallHistory,
Earning,
Wallet,
WalletTransaction
} from "../models/index.js";

let claimsTableReady = false;
let masterTasksTableReady = false;

const parseRequirements =
(value)=>{

if(!value){
return {};
}

if(typeof value === "object"){
return value;
}

try{
return JSON.parse(value);
}catch(error){
return {};
}

};

const normalizeTask =
(row)=>({
id:row.id,
title:row.title,
description:row.description,
rewardCoins:Number(row.rewardCoins) || 0,
cadence:row.cadence || "daily",
requirements:parseRequirements(row.requirements),
active:Boolean(row.active),
sortOrder:Number(row.sortOrder) || 0,
createdAt:row.createdAt,
updatedAt:row.updatedAt
});

const slugifyTaskId =
(title)=>(
String(title || "task")
.toLowerCase()
.replace(/[^a-z0-9]+/g,"_")
.replace(/^_+|_+$/g,"")
|| "task"
);

const ensureMasterTasksTable =
async()=>{

if(masterTasksTableReady){
return;
}

await sequelize.query(
`CREATE TABLE IF NOT EXISTS female_master_tasks (
id VARCHAR(64) NOT NULL PRIMARY KEY,
title VARCHAR(160) NOT NULL,
description TEXT NULL,
rewardCoins INT NOT NULL DEFAULT 0,
cadence VARCHAR(20) NOT NULL DEFAULT 'daily',
requirements JSON NULL,
active TINYINT(1) NOT NULL DEFAULT 1,
sortOrder INT NOT NULL DEFAULT 0,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
);

for(
let index = 0;
index < FEMALE_TASK_DEFINITIONS.length;
index += 1
){

const task =
FEMALE_TASK_DEFINITIONS[index];

await sequelize.query(
`INSERT IGNORE INTO female_master_tasks
(id, title, description, rewardCoins, cadence, requirements, active, sortOrder)
VALUES (:id, :title, :description, :rewardCoins, :cadence, :requirements, 1, :sortOrder)`,
{
replacements:{
id:task.id,
title:task.title,
description:task.description,
rewardCoins:task.rewardCoins,
cadence:task.cadence,
requirements:JSON.stringify(task.requirements || {}),
sortOrder:index + 1
}
}
);

}

masterTasksTableReady = true;

};

const ensureClaimsTable =
async()=>{

if(claimsTableReady){
return;
}

await sequelize.query(
`CREATE TABLE IF NOT EXISTS female_task_claims (
id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
userId BIGINT NOT NULL,
taskId VARCHAR(64) NOT NULL,
claimKey VARCHAR(32) NOT NULL,
rewardCoins INT NOT NULL DEFAULT 0,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE KEY unique_female_task_claim (userId, taskId, claimKey)
)`
);

claimsTableReady = true;

};

const getTodayKey =
()=>{

const now =
new Date();

const year =
now.getFullYear();

const month =
String(now.getMonth() + 1).padStart(2,"0");

const day =
String(now.getDate()).padStart(2,"0");

return `${year}-${month}-${day}`;

};

const getClaimKeyForTask =
(task)=>
task.cadence === "daily"
?
getTodayKey()
:
"lifetime";

const getDayBounds =
(dateKey)=>{

const start =
new Date(`${dateKey}T00:00:00`);

const end =
new Date(start);

end.setDate(end.getDate() + 1);

return {
start,
end
};

};

export {
recordFemaleDailyLogin,
recordFemaleOnlineHeartbeat
};

export const getMasterFemaleTasks =
async({
includeInactive = false
} = {})=>{

await ensureMasterTasksTable();

const rows =
await sequelize.query(
`SELECT *
FROM female_master_tasks
${includeInactive ? "" : "WHERE active = 1"}
ORDER BY sortOrder ASC, createdAt ASC`,
{
type:QueryTypes.SELECT
}
);

return rows.map(
normalizeTask
);

};

export const getFemaleTaskDefinition =
async(taskId)=>{

const tasks =
await getMasterFemaleTasks({
includeInactive:true
});

return tasks.find(
(task)=>task.id === taskId
);

};

export const createMasterFemaleTask =
async(task)=>{

await ensureMasterTasksTable();

const baseId =
slugifyTaskId(task.id || task.title);

let id =
baseId;

let suffix =
1;

while(
await getFemaleTaskDefinition(id)
){

suffix += 1;
id = `${baseId}_${suffix}`;

}

await sequelize.query(
`INSERT INTO female_master_tasks
(id, title, description, rewardCoins, cadence, requirements, active, sortOrder)
VALUES (:id, :title, :description, :rewardCoins, :cadence, :requirements, :active, :sortOrder)`,
{
replacements:{
id,
title:task.title,
description:task.description || "",
rewardCoins:Number(task.rewardCoins) || 0,
cadence:task.cadence || "daily",
requirements:JSON.stringify(task.requirements || {}),
active:task.active === false ? 0 : 1,
sortOrder:Number(task.sortOrder) || 0
}
}
);

return getFemaleTaskDefinition(id);

};

export const updateMasterFemaleTask =
async(
taskId,
task
)=>{

await ensureMasterTasksTable();

const existing =
await getFemaleTaskDefinition(taskId);

if(!existing){
throw new Error("Task not found");
}

const next = {
title:task.title ?? existing.title,
description:task.description ?? existing.description,
rewardCoins:task.rewardCoins ?? existing.rewardCoins,
cadence:task.cadence ?? existing.cadence,
requirements:task.requirements ?? existing.requirements,
active:task.active ?? existing.active,
sortOrder:task.sortOrder ?? existing.sortOrder
};

await sequelize.query(
`UPDATE female_master_tasks
SET title = :title,
description = :description,
rewardCoins = :rewardCoins,
cadence = :cadence,
requirements = :requirements,
active = :active,
sortOrder = :sortOrder,
updatedAt = NOW()
WHERE id = :taskId`,
{
replacements:{
taskId,
title:next.title,
description:next.description,
rewardCoins:Number(next.rewardCoins) || 0,
cadence:next.cadence || "daily",
requirements:JSON.stringify(next.requirements || {}),
active:next.active ? 1 : 0,
sortOrder:Number(next.sortOrder) || 0
}
}
);

return getFemaleTaskDefinition(taskId);

};

const getCallStatsForDay =
async(
userId,
dateKey
)=>{

const {
start,
end
}=getDayBounds(dateKey);

const completedCalls =
await CallHistory.findAll({
where:{
receiverId:userId,
status:"completed",
createdAt:{
[Op.gte]:start,
[Op.lt]:end
}
},
attributes:[
"id",
"type",
"duration"
]
});

const totalCalls =
completedCalls.length;

const videoCallsOneMinute =
completedCalls.filter(
(call)=>
String(call.type).toLowerCase() === "video" &&
Number(call.duration ?? 0) >= 60
).length;

return {
totalCalls,
videoCallsOneMinute
};

};

const getGoldStats =
async(
userId,
dateKey
)=>{

const {
start,
end
}=getDayBounds(dateKey);

const allEarnings =
await Earning.findAll({
where:{
userId
},
attributes:[
"coins",
"createdAt"
]
});

const totalGold =
allEarnings.reduce(
(sum,item)=>
sum + Number(item.coins ?? 0),
0
);

const goldEarnedToday =
allEarnings
.filter(
(item)=>{
const createdAt =
new Date(item.createdAt);

return (
createdAt >= start &&
createdAt < end
);
}
)
.reduce(
(sum,item)=>
sum + Number(item.coins ?? 0),
0
);

return {
totalGold,
goldEarnedToday
};

};

const getClaimedTaskKeys =
async(
userId
)=>{

await ensureClaimsTable();

const rows =
await sequelize.query(
`SELECT taskId, claimKey
FROM female_task_claims
WHERE userId = :userId`,
{
replacements:{
userId
},
type:QueryTypes.SELECT
}
);

return new Set(
rows.map(
(row)=>`${row.taskId}:${row.claimKey}`
)
);

};

const buildTaskProgress =
(
task,
stats,
claimedKeys
)=>{

const claimKey =
getClaimKeyForTask(task);
const claimToken =
`${task.id}:${claimKey}`;
const claimed =
claimedKeys.has(claimToken);

const requirements =
task.requirements ?? {};

const progress = {
loggedIn:stats.loggedIn,
onlineMinutes:stats.onlineMinutes,
totalCalls:stats.totalCalls,
videoCallsOneMinute:stats.videoCallsOneMinute,
goldEarnedToday:stats.goldEarnedToday,
totalGold:stats.totalGold
};

const checks = [];

if(requirements.loggedIn){
checks.push(progress.loggedIn);
}

if(requirements.minVideoCallsOneMinute){
checks.push(
progress.videoCallsOneMinute >=
requirements.minVideoCallsOneMinute
);
}

if(requirements.minOnlineMinutes){
checks.push(
progress.onlineMinutes >=
requirements.minOnlineMinutes
);
}

if(requirements.minCalls){
checks.push(
progress.totalCalls >=
requirements.minCalls
);
}

if(requirements.minGoldEarnedToday){
checks.push(
progress.goldEarnedToday >=
requirements.minGoldEarnedToday
);
}

if(requirements.minTotalGold){
checks.push(
progress.totalGold >=
requirements.minTotalGold
);
}

const completed =
checks.length > 0 &&
checks.every(Boolean);

const claimable =
completed &&
!claimed;

return {
id:task.id,
title:task.title,
description:task.description,
rewardCoins:task.rewardCoins,
cadence:task.cadence,
requirements:task.requirements,
progress,
completed,
claimed,
claimable,
locked:claimed
};

};

export const getFemaleTaskOverview =
async(
userId
)=>{

await recordFemaleDailyLogin(userId);

const dateKey =
getTodayKey();

const [
onlineStats,
callStats,
goldStats,
claimedKeys
]=
await Promise.all([
getFemaleOnlineTimeStats(userId),
getCallStatsForDay(
userId,
dateKey
),
getGoldStats(
userId,
dateKey
),
getClaimedTaskKeys(userId)
]);

const stats = {
loggedIn:onlineStats.loggedIn,
onlineMinutes:onlineStats.todayOnlineMinutes,
totalOnlineMinutes:onlineStats.totalOnlineMinutes,
totalCalls:callStats.totalCalls,
videoCallsOneMinute:callStats.videoCallsOneMinute,
goldEarnedToday:goldStats.goldEarnedToday,
totalGold:goldStats.totalGold
};

const tasks =
(
await getMasterFemaleTasks()
).map(
(task)=>
buildTaskProgress(
task,
stats,
claimedKeys
)
);

return {
activityDate:dateKey,
stats,
onlineTime:onlineStats,
tasks,
dailyTasks:tasks.filter(
(task)=>task.cadence === "daily"
),
lifetimeTasks:tasks.filter(
(task)=>task.cadence === "lifetime"
)
};

};

export const listFemaleTaskClaims = async ({
  date,
  taskId,
  cadence = "daily",
  search = "",
  limit = 500,
} = {}) => {
  await ensureClaimsTable();
  await ensureMasterTasksTable();

  const normalizedCadence = String(cadence || "daily").trim().toLowerCase();
  const claimDate = String(date || getTodayKey()).trim();
  const whereParts = ["1 = 1"];
  const replacements = {
    limit: Math.min(Math.max(Number(limit) || 500, 1), 1000),
  };

  if (normalizedCadence === "daily") {
    whereParts.push("c.claimKey = :claimKey");
    replacements.claimKey = claimDate;
  } else if (normalizedCadence === "lifetime") {
    whereParts.push("c.claimKey = 'lifetime'");
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
      c.createdAt,
      u.name,
      u.nickname,
      u.username,
      u.phone,
      u.publicUserId,
      t.title AS taskTitle,
      t.cadence AS taskCadence
    FROM female_task_claims c
    JOIN users u ON u.id = c.userId
    LEFT JOIN female_master_tasks t ON t.id = c.taskId
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
    taskCadence: row.taskCadence || (row.claimKey === "lifetime" ? "lifetime" : "daily"),
    claimKey: row.claimKey,
    rewardCoins: Number(row.rewardCoins) || 0,
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

  const tasks = await getMasterFemaleTasks({
    includeInactive: true,
  });

  const uniqueUsers = new Set(mapped.map((row) => row.userId)).size;
  const totalRewardCoins = mapped.reduce(
    (sum, row) => sum + Number(row.rewardCoins || 0),
    0
  );

  return {
    summary: {
      totalClaims: mapped.length,
      uniqueUsers,
      totalRewardCoins,
      claimDate: normalizedCadence === "lifetime" ? "lifetime" : claimDate,
      cadence: normalizedCadence,
      taskId: taskId || null,
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      cadence: task.cadence,
    })),
    rows: mapped,
  };
};

export const claimFemaleTaskReward =
async(
userId,
taskId
)=>{

const task =
await getFemaleTaskDefinition(taskId);

if(
!task ||
!task.active
){
throw new Error("Task not found");
}

const overview =
await getFemaleTaskOverview(userId);

const taskState =
overview.tasks.find(
(item)=>item.id === taskId
);

if(!taskState){
throw new Error("Task not found");
}

if(taskState.claimed){
throw new Error("Reward already claimed");
}

if(!taskState.claimable){
throw new Error("Task requirements not completed yet");
}

await ensureClaimsTable();

const claimKey =
getClaimKeyForTask(task);

const transaction =
await sequelize.transaction();

try{

await sequelize.query(
`INSERT INTO female_task_claims
(userId, taskId, claimKey, rewardCoins)
VALUES (:userId, :taskId, :claimKey, :rewardCoins)`,
{
replacements:{
userId,
taskId,
claimKey,
rewardCoins:task.rewardCoins
},
type:QueryTypes.INSERT,
transaction
}
);

let wallet =
await Wallet.findOne({
where:{
userId
},
transaction
});

if(!wallet){
wallet =
await Wallet.create(
{
userId,
balance:0
},
{
transaction
}
);
}

wallet.balance =
Number(wallet.balance ?? 0) +
Number(task.rewardCoins);

await wallet.save({
transaction
});

await WalletTransaction.create(
{
userId,
type:"task_reward",
amount:task.rewardCoins,
description:`Task reward: ${task.title}`
},
{
transaction
}
);

await Earning.create(
{
userId,
callId:null,
coins:task.rewardCoins,
amount:task.rewardCoins / 2,
duration:0,
status:"paid"
},
{
transaction
}
);

await transaction.commit();

return {
success:true,
taskId,
rewardCoins:task.rewardCoins,
walletBalance:wallet.balance,
taskTitle:task.title,
message:"Task reward claimed successfully"
};

}catch(error){

await transaction.rollback();

if(
String(error?.message ?? "")
.includes("unique_female_task_claim")
){
throw new Error("Reward already claimed");
}

throw error;

}

};
