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

let history =
null;

if(callHistoryId){
 history =
 await CallHistory.findByPk(callHistoryId);
}

if(!history){
 history =
 await findActiveCallByPair(
 callerId,
 receiverId
 );
}

const normalizedDuration =
Math.max(
0,
Number(duration ?? 0),
Number(history?.duration ?? 0)
);

const billing =
await calculateCallBilling({
duration:normalizedDuration,
type:normalizedType || history?.type,
receiverId,
callerId
});

const upsertCallEarning =
async(
callId,
femaleUserId
)=>{
 if(
 !callId ||
 billing.femaleEarn <= 0
 ){
  return null;
 }

 const [
 earning,
 created
 ]=
 await Earning.findOrCreate({

 where:{
  callId
 },

 defaults:{
  userId:femaleUserId,
  coins:billing.femaleEarn,
  amount:billing.femaleAmount,
  duration:billing.minutes,
  status:"pending"
 }

 });

 if(!created){
  const existingCoins =
  Number(earning.coins || 0);

  const existingAmount =
  Number(earning.amount || 0);

  const nextCoins =
  Math.max(
  existingCoins,
  billing.femaleEarn
  );

  const nextAmount =
  Math.max(
  existingAmount,
  billing.femaleAmount
  );

  if(
  nextCoins !== existingCoins ||
  nextAmount !== existingAmount ||
  Number(earning.duration || 0) !==
  Number(billing.minutes || 0)
  ){
   await earning.update({
   coins:nextCoins,
   amount:nextAmount,
   duration:billing.minutes
   });
  }
 }

 return earning;
};

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

 const storedCoinsSpent =
 Number(history.coinsSpent || 0);

 const shouldRefresh =
 billing.maleCost > storedCoinsSpent ||
 (
  billing.femaleEarn > 0 &&
  (
   !existingEarning ||
   billing.femaleEarn >
   Number(existingEarning.coins || 0) ||
   billing.femaleAmount >
   Number(existingEarning.amount || 0)
  )
 );

 if(!shouldRefresh){
  return {
   history,
   earning:existingEarning,
   billing,
   alreadyCompleted:true
  };
 }

 await history.update({
 type:normalizedType || history.type,
 duration:normalizedDuration,
 coinsSpent:Math.max(
  storedCoinsSpent,
  billing.maleCost
 ),
 status:"completed"
 });

 const earning =
 await upsertCallEarning(
 history.id,
 receiverId
 );

 return {
  history,
  earning,
  billing,
  alreadyCompleted:false,
  refreshed:true
 };
}

if(history){
 await history.update({
 type:normalizedType || history.type,
 duration:normalizedDuration,
 coinsSpent:billing.maleCost,
 status:"completed"
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

const earning =
await upsertCallEarning(
history.id,
receiverId
);

return {
 history,
 earning,
 billing,
 alreadyCompleted:false
};

};

export const repairMissingCallEarnings =
async({
callerId = null,
receiverId = null,
sinceHours = 48
} = {})=>{

const since =
new Date(
Date.now() -
Number(sinceHours || 48) *
60 *
60 *
1000
);

const where = {
 status:"completed",
 coinsSpent:{
  [Op.gt]:0
 },
 updatedAt:{
  [Op.gte]:since
 }
};

if(
callerId &&
Number.isFinite(Number(callerId))
){
 where.callerId =
 Number(callerId);
}

if(
receiverId &&
Number.isFinite(Number(receiverId))
){
 where.receiverId =
 Number(receiverId);
}

const calls =
await CallHistory.findAll({
 where,
 order:[
  ["updatedAt","DESC"]
 ]
});

const results = [];

for(
const call of calls
){
 const existing =
 await Earning.findOne({
  where:{
   callId:call.id
  }
 });

 const duration =
 Math.max(
 0,
 Number(call.duration || 0)
 );

 const billing =
 await calculateCallBilling({
 duration,
 type:call.type,
 receiverId:call.receiverId,
 callerId:call.callerId
 });

 if(
 existing &&
 Number(existing.coins || 0) >=
 billing.femaleEarn &&
 Number(existing.amount || 0) >=
 billing.femaleAmount
 ){
  continue;
 }

 const {
 earning
 }=
 await completeCallRecord({
 callerId:call.callerId,
 receiverId:call.receiverId,
 type:call.type,
 duration,
 callHistoryId:call.id
 });

 results.push({
 callId:call.id,
 callerId:call.callerId,
 receiverId:call.receiverId,
 coinsSpent:Number(call.coinsSpent || 0),
 femaleCoins:Number(earning?.coins || 0),
 femaleAmount:Number(earning?.amount || 0),
 repaired:Boolean(earning)
 });
}

return {
 scanned:calls.length,
 repaired:results.length,
 results
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
),
Number(call.duration) || 0
);

try{
await completeCallRecord({
callerId:call.callerId,
receiverId:call.receiverId,
type:call.type,
duration:elapsedSeconds,
callHistoryId:call.id
});
}catch(error){
console.log(
"CLEANUP STALE CALL BILLING ERROR",
call.id,
error.message
);
}
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
),
Number(row.duration) || 0
);

try{
await completeCallRecord({
callerId:row.callerId,
receiverId:row.receiverId,
type:row.type,
duration:elapsedSeconds,
callHistoryId:row.id
});
}catch(error){
console.log(
"CLEANUP GHOST CALL BILLING ERROR",
row.id,
error.message
);
}
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
