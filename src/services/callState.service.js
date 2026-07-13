import { Op } from "sequelize";

import {
CallHistory,
Earning
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

const [
earning
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
