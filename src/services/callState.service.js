import { Op } from "sequelize";

import {
CallHistory,
Earning,
User
} from "../models/index.js";
import {
normalizeCallTypeForDb
} from "../constants/callTypes.js";
import {
calculateCallBilling
} from "./callRate.service.js";

export const ACTIVE_CALL_STATUSES = [
"live",
"ringing",
"ongoing",
"in_progress",
"accepted"
];

export const TERMINAL_CALL_STATUSES = [
"completed",
"rejected",
"missed",
"cancelled"
];

export const findActiveCallByPair =
async(
callerId,
receiverId
)=>
CallHistory.findOne({

where:{
 callerId,
 receiverId,
 status:{
  [Op.in]:ACTIVE_CALL_STATUSES
 }
},

order:[
 ["createdAt","DESC"]
]

});

export const findActiveCallForReceiver =
async(
receiverId,
excludeCallerId = null
)=>{

const where = {
 receiverId,
 status:{
  [Op.in]:ACTIVE_CALL_STATUSES
 }
};

if(excludeCallerId){
 where.callerId = {
  [Op.ne]:excludeCallerId
 };
}

return CallHistory.findOne({

where,

order:[
 ["createdAt","DESC"]
]

});

};

export const isReceiverBusyWithOther =
async(
receiverId,
callerId
)=>{

const busyCall =
await findActiveCallForReceiver(
receiverId,
callerId
);

return Boolean(busyCall);

};

export const completeCallRecord =
async({
callerId,
receiverId,
type,
duration,
callHistoryId
})=>{

const normalizedType =
normalizeCallTypeForDb(type);

const normalizedDuration =
Math.max(
0,
Number(duration ?? 0)
);

const billing =
await calculateCallBilling({
duration:normalizedDuration,
type:normalizedType,
receiverId
});

let history =
null;

if(callHistoryId){
 history =
 await CallHistory.findByPk(callHistoryId);
}

if(
history &&
TERMINAL_CALL_STATUSES.includes(history.status)
){
 const existingEarning =
 await Earning.findOne({
  where:{
   callId:history.id
  }
 });

 return {
  history,
  earning:existingEarning,
  billing,
  alreadyCompleted:true
 };
}

if(!history){
 history =
 await findActiveCallByPair(
 callerId,
 receiverId
 );
}

if(history){
 await history.update({
 type:normalizedType || history.type,
 duration:normalizedDuration,
 coinsSpent:billing.maleCost,
 status:"completed"
 });
}else{
 const recentCompleted =
 await CallHistory.findOne({

 where:{
  callerId,
  receiverId,
  status:"completed",
  updatedAt:{
   [Op.gte]:new Date(
   Date.now() -
   3 *
   60 *
   1000
   )
  }
 },

 order:[
  ["updatedAt","DESC"]
 ]

 });

 if(recentCompleted){
  history =
  recentCompleted;

  await history.update({
  type:normalizedType || history.type,
  duration:normalizedDuration,
  coinsSpent:billing.maleCost
  });
 }else{
  history =
  await CallHistory.create({
  callerId,
  receiverId,
  type:normalizedType,
  duration:normalizedDuration,
  coinsSpent:billing.maleCost,
  status:"completed"
  });
 }
}

let earning =
null;

if(billing.femaleEarn > 0){
 const [
 createdEarning
 ]=
 await Earning.findOrCreate({

 where:{
  callId:history.id
 },

 defaults:{
  userId:receiverId,
  coins:billing.femaleEarn,
  amount:billing.femaleAmount,
  duration:billing.minutes,
  status:"pending"
 }

 });

 earning =
 createdEarning;
}

return {
 history,
 earning,
 billing,
 alreadyCompleted:false
};

};

export const getChannelNameForCall =
(callId)=>
`call_${callId}`;

export const cleanupStaleActiveCalls =
async(
options = {}
)=>{
const ringingStaleMinutes =
Number(
options.ringingStaleMinutes ??
process.env.LIVE_CALL_RINGING_STALE_MINUTES ??
3
);

const activeStaleMinutes =
Number(
options.activeStaleMinutes ??
process.env.LIVE_CALL_STALE_MINUTES ??
30
);

const ghostStaleMinutes =
Number(
options.ghostStaleMinutes ??
process.env.LIVE_CALL_GHOST_STALE_MINUTES ??
2
);

const now =
Date.now();

await CallHistory.update(
{
status:"cancelled",
duration:0
},
{
where:{
status:{
[Op.in]:[
"live",
"ringing"
]
},
createdAt:{
[Op.lt]:new Date(
now -
ringingStaleMinutes *
60 *
1000
)
}
}
}
);

const staleAccepted =
await CallHistory.findAll({
where:{
status:{
[Op.in]:[
"accepted",
"ongoing",
"in_progress"
]
},
createdAt:{
[Op.lt]:new Date(
now -
activeStaleMinutes *
60 *
1000
)
}
}
});

for(
const call of staleAccepted
){
const elapsedSeconds =
Math.max(
0,
Math.floor(
(now - new Date(call.createdAt).getTime()) / 1000
)
);

await call.update({
status:"completed",
duration:
Number(call.duration) > 0
?
Number(call.duration)
:
elapsedSeconds
});
}

const ghostCalls =
await CallHistory.findAll({
where:{
status:{
[Op.in]:ACTIVE_CALL_STATUSES
},
createdAt:{
[Op.lt]:new Date(
now -
ghostStaleMinutes *
60 *
1000
)
},
coinsSpent:0
},
include:[
{
model:User,
as:"caller",
attributes:["online"]
},
{
model:User,
as:"receiver",
attributes:["online"]
}
]
});

for(
const call of ghostCalls
){
const row =
call.toJSON();

if(
Boolean(row.caller?.online) ||
Boolean(row.receiver?.online)
){
continue;
}

const elapsedSeconds =
Math.max(
0,
Math.floor(
(now - new Date(row.createdAt).getTime()) / 1000
)
);

await call.update({
status:"completed",
duration:
Number(row.duration) > 0
?
Number(row.duration)
:
elapsedSeconds
});
}
};

export const closeActiveCallsForUser =
async(
userId,
terminalStatus = "cancelled"
)=>{
const userIdNum =
Number(userId);

if(
!Number.isFinite(userIdNum)
){
return;
}

await CallHistory.update(
{
status:terminalStatus
},
{
where:{
[Op.or]:[
{
callerId:userIdNum
},
{
receiverId:userIdNum
}
],
status:{
[Op.in]:ACTIVE_CALL_STATUSES
}
}
}
);
};
