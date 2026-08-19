import { Op } from "sequelize";

import {
Broadcast,
BroadcastSchedule
} from "../models/index.js";
import {
notifyAllUsersOnBroadcast,
notifyFemalesOnBroadcast,
notifyMalesOnBroadcast
} from "./notificationPush.service.js";

export const MAX_PENDING_SCHEDULES_PER_AUDIENCE = 10;

const TYPE_TO_DB = {
general:"info",
offer:"offer",
creator:"info",
alert:"warning",
info:"info",
warning:"warning"
};

const TYPE_FROM_DB = {
info:"general",
offer:"offer",
warning:"alert"
};

const AUDIENCE_LABELS = {
female:"All Females",
male:"All Males",
all:"All Users"
};

const normalizeAudience =
(value)=>{
const audience =
String(value || "female").trim().toLowerCase();

if(
audience === "male" ||
audience === "all" ||
audience === "female"
){
return audience;
}

throw new Error("Invalid audience");
};

export const parseIstDateTime =
(value)=>{
const raw =
String(value || "").trim();

if(!raw){
throw new Error("Schedule time is required");
}

const normalized =
raw.includes("+") ||
raw.endsWith("Z")
?
raw
:
`${raw.length === 16 ? `${raw}:00` : raw}+05:30`;

const date =
new Date(normalized);

if(Number.isNaN(date.getTime())){
throw new Error("Invalid schedule time");
}

if(date.getTime() <= Date.now()){
throw new Error("Schedule time must be in the future (IST)");
}

return date;
};

export const formatUtcAsIst =
(dateValue)=>{
if(!dateValue){
return "";
}

return new Date(dateValue).toLocaleString(
"en-IN",
{
timeZone:"Asia/Kolkata",
day:"2-digit",
month:"short",
year:"numeric",
hour:"2-digit",
minute:"2-digit",
hour12:true
}
);
};

const formatBroadcastPayload =
(row)=>{
const data =
row.toJSON ?
row.toJSON() :
row;

return {
id:data.id,
title:data.title,
message:data.message,
type:TYPE_FROM_DB[data.type] || data.type || "general",
dbType:data.type,
active:data.active,
targetUserId:data.targetUserId ?? null,
scope:data.targetAudience || "female",
audience:data.targetAudience,
audienceLabel:AUDIENCE_LABELS[data.targetAudience] || AUDIENCE_LABELS.female,
createdAt:data.createdAt,
updatedAt:data.updatedAt
};
};

export const formatScheduleRow =
(row)=>{
const data =
row.toJSON ?
row.toJSON() :
row;

return {
id:data.id,
title:data.title,
message:data.message,
type:TYPE_FROM_DB[data.type] || data.type || "general",
audience:data.targetAudience,
audienceLabel:AUDIENCE_LABELS[data.targetAudience] || AUDIENCE_LABELS.female,
scheduledAtUtc:data.scheduledAtUtc,
scheduledAtIst:formatUtcAsIst(data.scheduledAtUtc),
status:data.status,
broadcastId:data.broadcastId ?? null,
createdByAdminId:data.createdByAdminId ?? null,
sentAt:data.sentAt ?? null,
sentAtIst:data.sentAt ?
formatUtcAsIst(data.sentAt) :
null,
errorMessage:data.errorMessage ?? null,
createdAt:data.createdAt,
updatedAt:data.updatedAt
};
};

const countPendingForAudience =
async(audience)=>{
return BroadcastSchedule.count({
where:{
targetAudience:audience,
status:"pending"
}
});
};

export const getScheduleSummary =
async()=>{
const audiences =
["female","male","all"];

const summary =
{};

for(
const audience of audiences
){
summary[audience] =
await countPendingForAudience(audience);
}

return {
maxPerAudience:MAX_PENDING_SCHEDULES_PER_AUDIENCE,
pendingCounts:summary
};
};

export const listBroadcastSchedules =
async({
audience = null,
includeHistory = true
} = {})=>{
const where = {};

if(audience){
where.targetAudience =
normalizeAudience(audience);
}

if(!includeHistory){
where.status = "pending";
}

const rows =
await BroadcastSchedule.findAll({
where,
order:[
["scheduledAtUtc","ASC"],
["id","ASC"]
]
});

return rows.map(formatScheduleRow);
};

export const createBroadcastSchedule =
async({
title,
message,
type,
audience,
scheduledAtIst,
createdByAdminId = null
})=>{
const targetAudience =
normalizeAudience(audience);

if(
!title?.trim() ||
!message?.trim()
){
throw new Error("Title and message are required");
}

const pendingCount =
await countPendingForAudience(targetAudience);

if(
pendingCount >=
MAX_PENDING_SCHEDULES_PER_AUDIENCE
){
throw new Error(
`Maximum ${MAX_PENDING_SCHEDULES_PER_AUDIENCE} pending schedules allowed for ${AUDIENCE_LABELS[targetAudience]}`
);
}

const scheduledAtUtc =
parseIstDateTime(scheduledAtIst);

const dbType =
TYPE_TO_DB[type] ||
"info";

const row =
await BroadcastSchedule.create({
title:title.trim(),
message:message.trim(),
type:dbType,
targetAudience,
scheduledAtUtc,
status:"pending",
createdByAdminId:
createdByAdminId ?
String(createdByAdminId)
:
null
});

return formatScheduleRow(row);
};

export const updateBroadcastSchedule =
async(
scheduleId,
{
title,
message,
type,
scheduledAtIst
}
)=>{
const row =
await BroadcastSchedule.findByPk(scheduleId);

if(!row){
throw new Error("Schedule not found");
}

if(row.status !== "pending"){
throw new Error("Only pending schedules can be edited");
}

const updates = {};

if(title !== undefined){
if(!String(title).trim()){
throw new Error("Title is required");
}

updates.title =
String(title).trim();
}

if(message !== undefined){
if(!String(message).trim()){
throw new Error("Message is required");
}

updates.message =
String(message).trim();
}

if(type !== undefined){
updates.type =
TYPE_TO_DB[type] ||
"info";
}

if(scheduledAtIst !== undefined){
updates.scheduledAtUtc =
parseIstDateTime(scheduledAtIst);
}

await row.update(updates);

return formatScheduleRow(row);
};

export const cancelBroadcastSchedule =
async(scheduleId)=>{
const row =
await BroadcastSchedule.findByPk(scheduleId);

if(!row){
throw new Error("Schedule not found");
}

if(row.status !== "pending"){
throw new Error("Only pending schedules can be cancelled");
}

await row.update({
status:"cancelled"
});

return formatScheduleRow(row);
};

export const executeBroadcastSchedule =
async(scheduleRow)=>{
const data =
scheduleRow.toJSON ?
scheduleRow.toJSON() :
scheduleRow;

const broadcast =
await Broadcast.create({
title:data.title,
message:data.message,
type:data.type,
active:true,
targetUserId:null,
targetAudience:data.targetAudience
});

const payload =
formatBroadcastPayload(broadcast);

const notifyHandler =
data.targetAudience === "male"
?
notifyMalesOnBroadcast
:
data.targetAudience === "all"
?
notifyAllUsersOnBroadcast
:
notifyFemalesOnBroadcast;

await notifyHandler(payload);

return broadcast;
};

export const processDueBroadcastSchedules =
async()=>{
const dueRows =
await BroadcastSchedule.findAll({
where:{
status:"pending",
scheduledAtUtc:{
[Op.lte]:new Date()
}
},
order:[
["scheduledAtUtc","ASC"],
["id","ASC"]
],
limit:20
});

const results = [];

for(
const row of dueRows
){
const [
updatedCount
] =
await BroadcastSchedule.update(
{
status:"processing"
},
{
where:{
id:row.id,
status:"pending"
}
}
);

if(!updatedCount){
continue;
}

try{
const broadcast =
await executeBroadcastSchedule(row);

await BroadcastSchedule.update(
{
status:"sent",
sentAt:new Date(),
broadcastId:broadcast.id,
errorMessage:null
},
{
where:{
id:row.id
}
}
);

results.push({
id:row.id,
status:"sent",
broadcastId:broadcast.id
});
}catch(error){
await BroadcastSchedule.update(
{
status:"failed",
errorMessage:error.message
},
{
where:{
id:row.id
}
}
);

results.push({
id:row.id,
status:"failed",
error:error.message
});
}
}

return {
processed:results.length,
results
};
};

export const startBroadcastScheduleWorker =
()=>{
const intervalMs =
Number(
process.env.BROADCAST_SCHEDULE_POLL_MS ||
30_000
);

const tick =
async()=>{
try{
const result =
await processDueBroadcastSchedules();

if(result.processed > 0){
console.log(
"BROADCAST SCHEDULES PROCESSED",
result
);
}
}catch(error){
console.log(
"BROADCAST SCHEDULE WORKER ERROR",
error.message
);
}
};

setInterval(
tick,
intervalMs
);

void tick();

console.log(
`Broadcast schedule worker started (every ${intervalMs}ms)`
);
};
