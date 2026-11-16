import { Op } from "sequelize";

import { sequelize } from "../config/database.js";
import {
CallHistory,
Earning,
User
} from "../models/index.js";
import {
computeSettlementEarnings,
resolveRecordedDuration
} from "../utils/callSettlement.util.js";
import { getCollectedCallCoins } from "./callSettlement.service.js";
import {
normalizeCallTypeForDb
} from "../constants/callTypes.js";
import {
calculateCallBilling
} from "./callRate.service.js";
import {
  recordCallCompletedFromHistory,
} from "./engagementRecord.service.js";

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

const emptyBilling = () => ({
 minutes:0,
 maleCost:0,
 recordedCost:0,
 collectedCoins:0,
 earnableCoins:0,
 femaleEarn:0,
 femaleAmount:0,
 femaleEarningPercentage:0
});

const findCallForCompletion =
async({
callHistoryId,
callerId,
receiverId,
transaction
})=>{
 const lock = transaction.LOCK.UPDATE;
 let history = null;

 if(callHistoryId){
  history =
  await CallHistory.findByPk(
  callHistoryId,
  { transaction, lock }
  );

  // A client-supplied call id only counts when it belongs to the same pair.
  if(
   history &&
   callerId &&
   receiverId &&
   (
    Number(history.callerId) !== Number(callerId) ||
    Number(history.receiverId) !== Number(receiverId)
   )
  ){
   history = null;
  }
 }

 if(!history && callerId && receiverId){
  const active =
  await findActiveCallByPair(
  callerId,
  receiverId
  );

  if(active){
   history =
   await CallHistory.findByPk(
   active.id,
   { transaction, lock }
   );
  }
 }

 return history;
};

const raiseCallEarning =
async({
callId,
femaleUserId,
settlement,
minutes,
transaction
})=>{
 if(
  settlement.femaleEarn <= 0 &&
  settlement.femaleAmount <= 0
 ){
  return Earning.findOne({
   where:{ callId },
   transaction
  });
 }

 const existing =
 await Earning.findOne({
  where:{ callId },
  transaction,
  lock:transaction.LOCK.UPDATE
 });

 if(!existing){
  return Earning.create(
  {
   userId:femaleUserId,
   callId,
   coins:settlement.femaleEarn,
   amount:settlement.femaleAmount,
   duration:minutes,
   status:"pending"
  },
  { transaction }
  );
 }

 // Only pending earnings can still change; paid (or otherwise processed)
 // rows are part of a payout and are never touched.
 if(String(existing.status || "pending") !== "pending"){
  return existing;
 }

 // Earnings only ever rise toward the collected-coin cap; existing rows,
 // including ones written before Phase 1, are never reduced here.
 const nextCoins =
 Math.max(Number(existing.coins || 0), settlement.femaleEarn);

 const nextAmount =
 Math.max(Number(existing.amount || 0), settlement.femaleAmount);

 if(
  nextCoins !== Number(existing.coins || 0) ||
  nextAmount !== Number(existing.amount || 0)
 ){
  await existing.update(
  {
   coins:nextCoins,
   amount:nextAmount,
   duration:Math.max(Number(existing.duration || 0), Number(minutes || 0))
  },
  { transaction }
  );
 }

 return existing;
};

/**
 * Settles a call: records the server-derived duration and cost, and credits the
 * creator only from coins actually collected for this call (capped at the
 * cost). Concurrent calls for the same row are serialised by a row lock.
 *
 * Client-supplied durations are ignored once the server has seen the call
 * accepted; for older calls they are capped by wall-clock time.
 */
export const completeCallRecord =
async({
callerId,
receiverId,
type,
duration,
callHistoryId,
endReason = null,
endedAt = null
})=>{

let firstSettlement = false;

const result =
await sequelize.transaction(async(transaction)=>{
 const history =
 await findCallForCompletion({
  callHistoryId,
  callerId,
  receiverId,
  transaction
 });

 if(!history){
  return {
   history:null,
   earning:null,
   billing:emptyBilling(),
   alreadyCompleted:true,
   notFound:true
  };
 }

 const wasTerminal =
 TERMINAL_CALL_STATUSES.includes(history.status);

 const wasSettled =
 Boolean(history.settledAt);

 // Completed before Phase 1 with a cost already recorded: leave untouched.
 if(
  !wasSettled &&
  wasTerminal &&
  Number(history.coinsSpent || 0) > 0
 ){
  const existingEarning =
  await Earning.findOne({
   where:{ callId:history.id },
   transaction
  });

  return {
   history,
   earning:existingEarning,
   billing:{
    ...emptyBilling(),
    minutes:Math.ceil(Number(history.duration || 0) / 60),
    maleCost:Number(history.coinsSpent || 0),
    recordedCost:Number(history.coinsSpent || 0),
    femaleEarn:Number(existingEarning?.coins || 0),
    femaleAmount:Number(existingEarning?.amount || 0)
   },
   alreadyCompleted:true,
   legacy:true
  };
 }

 const now = new Date();
 const callType =
 normalizeCallTypeForDb(history.type || type);

 const recordedDuration =
 wasSettled
 ?
 Math.max(0, Number(history.duration || 0))
 :
 resolveRecordedDuration({
  acceptedAt:history.acceptedAt,
  endedAt:history.endedAt ?? endedAt ?? now,
  createdAt:history.createdAt,
  clientDuration:duration,
  storedDuration:history.duration,
  now:now.getTime()
 });

 const billing =
 await calculateCallBilling({
  duration:recordedDuration,
  type:callType,
  receiverId:history.receiverId,
  callerId:history.callerId
 });

 const collectedCoins =
 await getCollectedCallCoins({
  callId:history.id,
  callerId:history.callerId,
  transaction
 });

 // Server-billed calls were charged interval by interval on the server's own
 // schedule (including face-gate pauses), so that total is the call's cost.
 const recordedCost =
 wasSettled
 ?
 Number(history.coinsSpent || 0)
 :
 history.billingMode === "server"
 ?
 Math.min(collectedCoins, billing.maleCost)
 :
 billing.maleCost;

 const settlement =
 computeSettlementEarnings({
  collectedCoins,
  recordedCost,
  coinValue:billing.coinValue,
  creatorPercentage:billing.femaleEarningPercentage
 });

 const updates = {
  collectedCoins
 };

 if(!wasSettled){
  firstSettlement = true;
  updates.duration = recordedDuration;
  updates.coinsSpent = recordedCost;
  updates.endedAt = history.endedAt ?? endedAt ?? now;
  updates.settledAt = now;
  updates.endReason = history.endReason ?? endReason;

  if(
   recordedDuration > 0 ||
   collectedCoins > 0 ||
   !wasTerminal
  ){
   updates.status = "completed";
  }
 }

 await history.update(updates, { transaction });

 const earning =
 await raiseCallEarning({
  callId:history.id,
  femaleUserId:history.receiverId,
  settlement,
  minutes:billing.minutes,
  transaction
 });

 return {
  history,
  earning,
  billing:{
   ...billing,
   maleCost:recordedCost,
   recordedCost,
   collectedCoins,
   earnableCoins:settlement.earnableCoins,
   femaleEarn:settlement.femaleEarn,
   femaleAmount:settlement.femaleAmount
  },
  alreadyCompleted:wasSettled
 };
});

if(firstSettlement && result.history){
 recordCallCompletedFromHistory(result.history);
 // Male daily-task streak touch (non-blocking; eligibility still recomputed on claim).
 import("./maleTask.service.js")
  .then(({ onMaleCallSettledForTasks }) =>
   onMaleCallSettledForTasks(result.history)
  )
  .catch(() => {});
}

return result;

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
callHistoryId:call.id,
endReason:"stale_cleanup"
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
callHistoryId:row.id,
endReason:"ghost_cleanup"
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

const CONNECTED_CALL_STATUSES = [
"accepted",
"ongoing",
"in_progress"
];

const isConnectedCall =
(call)=>
Boolean(call.acceptedAt) ||
CONNECTED_CALL_STATUSES.includes(call.status);

/**
 * Ends a user's active calls. Calls that were never answered get
 * `terminalStatus`; answered calls are settled through completeCallRecord so
 * the creator is paid from collected coins exactly once.
 */
export const closeActiveCallsForUser =
async(
userId,
terminalStatus = "cancelled",
{
endedAt = null,
endReason = "participant_disconnected",
acceptedOnly = false,
unacceptedOnly = false
} = {}
)=>{
const userIdNum =
Number(userId);

if(
!Number.isFinite(userIdNum)
){
return { settled:0, closed:0 };
}

const calls =
await CallHistory.findAll({
where:{
[Op.or]:[
{ callerId:userIdNum },
{ receiverId:userIdNum }
],
status:{
[Op.in]:ACTIVE_CALL_STATUSES
}
},
attributes:[
"id",
"callerId",
"receiverId",
"type",
"status",
"acceptedAt"
]
});

let settled = 0;
let closed = 0;

for(const call of calls){
if(isConnectedCall(call)){
if(unacceptedOnly){
continue;
}

try{
await completeCallRecord({
callerId:call.callerId,
receiverId:call.receiverId,
type:call.type,
callHistoryId:call.id,
endedAt,
endReason
});
settled += 1;
}catch(error){
console.log(
"CLOSE CALL SETTLEMENT ERROR",
call.id,
error.message
);
}

continue;
}

if(acceptedOnly){
continue;
}

const [updated] =
await CallHistory.update(
{ status:terminalStatus },
{
where:{
id:call.id,
status:{ [Op.in]:ACTIVE_CALL_STATUSES }
}
}
);

closed += Number(updated || 0);
}

return { settled, closed };
};
