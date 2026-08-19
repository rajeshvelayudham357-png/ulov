import {
cancelBroadcastSchedule,
createBroadcastSchedule,
getScheduleSummary,
listBroadcastSchedules,
updateBroadcastSchedule
} from "../services/broadcastSchedule.service.js";

export const getBroadcastScheduleSummary =
async(req,res)=>{
try{
const summary =
await getScheduleSummary();

return res.json(summary);
}catch(error){
return res.status(500).json({
message:error.message
});
}
};

export const getBroadcastSchedules =
async(req,res)=>{
try{
const audience =
req.query.audience ?
String(req.query.audience)
:
null;

const includeHistory =
req.query.includeHistory !== "false";

const schedules =
await listBroadcastSchedules({
audience,
includeHistory
});

return res.json({
schedules
});
}catch(error){
return res.status(500).json({
message:error.message
});
}
};

export const createBroadcastScheduleHandler =
async(req,res)=>{
try{
const {
title,
message,
type,
audience,
scheduledAtIst
}=req.body;

const schedule =
await createBroadcastSchedule({
title,
message,
type,
audience,
scheduledAtIst,
createdByAdminId:req.admin?.sub ?? null
});

return res.status(201).json(schedule);
}catch(error){
const status =
error.message.includes("Maximum") ||
error.message.includes("required") ||
error.message.includes("Invalid") ||
error.message.includes("future")
?
400
:
500;

return res.status(status).json({
message:error.message
});
}
};

export const updateBroadcastScheduleHandler =
async(req,res)=>{
try{
const scheduleId =
Number(req.params.id);

if(
!Number.isFinite(scheduleId)
){
return res.status(400).json({
message:"Invalid schedule id"
});
}

const schedule =
await updateBroadcastSchedule(
scheduleId,
req.body
);

return res.json(schedule);
}catch(error){
const status =
error.message === "Schedule not found"
?
404
:
error.message.includes("Only pending") ||
error.message.includes("required") ||
error.message.includes("Invalid") ||
error.message.includes("future")
?
400
:
500;

return res.status(status).json({
message:error.message
});
}
};

export const cancelBroadcastScheduleHandler =
async(req,res)=>{
try{
const scheduleId =
Number(req.params.id);

if(
!Number.isFinite(scheduleId)
){
return res.status(400).json({
message:"Invalid schedule id"
});
}

const schedule =
await cancelBroadcastSchedule(scheduleId);

return res.json(schedule);
}catch(error){
const status =
error.message === "Schedule not found"
?
404
:
error.message.includes("Only pending")
?
400
:
500;

return res.status(status).json({
message:error.message
});
}
};
