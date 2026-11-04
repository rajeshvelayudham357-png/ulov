import {
    CallHistory,
    User,
    Earning
   }
   from "../models/index.js";
import {
Op
} from "sequelize";
import {
getBlockedPeerIds
} from "../services/block.service.js";
import {
completeCallRecord,
findActiveCallByPair
} from "../services/callState.service.js";
   
   
   
   // SAVE CALL
   
   
   export const saveCallHistory =
   async(req,res)=>{

   try{

   const userId =
   Number(req.user?.id);

   if(!userId){
   return res.status(401).json({
   message:"Unauthorized"
   });
   }

   const requestedCallId =
   Number(
   req.body?.callHistoryId ??
   req.body?.callId
   );

   let call = null;

   if(
   Number.isFinite(requestedCallId) &&
   requestedCallId > 0
   ){
   call =
   await CallHistory.findByPk(requestedCallId);
   }else if(
   req.body?.callerId &&
   req.body?.receiverId
   ){
   // Older clients may omit the id; only the requester's own call can be found.
   const callerId = Number(req.body.callerId);
   const receiverId = Number(req.body.receiverId);

   if(
   callerId === userId ||
   receiverId === userId
   ){
   call =
   await findActiveCallByPair(
   callerId,
   receiverId
   );
   }
   }

   if(!call){
   return res.status(404).json({
   message:"Call not found"
   });
   }

   if(
   Number(call.callerId) !== userId &&
   Number(call.receiverId) !== userId
   ){
   return res.status(403).json({
   message:"This call does not belong to you"
   });
   }

   // Client-supplied durations, costs and earnings are not used for billing;
   // the duration is passed only as a capped fallback for calls accepted
   // before the server recorded acceptedAt.
   const {
   history,
   earning,
   alreadyCompleted
   }=
   await completeCallRecord({
   callerId:call.callerId,
   receiverId:call.receiverId,
   type:call.type,
   duration:req.body?.duration,
   callHistoryId:call.id,
   endReason:
   Number(call.callerId) === userId
   ?
   "caller_ended"
   :
   "receiver_ended"
   });

   if(!history){
   return res.status(404).json({
   message:"Call not found"
   });
   }

   return res.json({
   success:true,
   alreadyCompleted,
   callHistoryId:history.id,
   history,
   earning
   });

   }catch(error){

   return res.status(500).json({
   message:error.message
   });

   }

   };
   
   
   
   
   
   
   
   
   // GET HISTORY
   
   
   export const getCallHistory =
   async(req,res)=>{
   
   
   try{
   
   
   const {
   userId
   }=req.params;
   
   
   
   
   const history =
   await CallHistory.findAll({
   
   
   where:{
   
   callerId:
   userId
   
   },
   
   
   
   include:[
   
   {
   
   model:User,
   
   as:"receiver"
   
   }
   
   ],
   
   
   
   
   order:[
   
   [
   "createdAt",
   "DESC"
   ]
   
   ]
   
   
   });
   
   
   
   
   
   
   return res.json({
   
   history:(
   await (async()=>{
   const blockedIds =
   await getBlockedPeerIds(userId);

   return history.filter(
   item=>
   item.receiver &&
   !blockedIds.has(Number(item.receiver.id))
   );
   })()
   )
   
   });
   
   
   
   
   
   
   }catch(error){
   
   
   
   return res.status(500).json({
   
   message:error.message
   
   });
   
   
   
   }
   
   
   };

   // =====================
// FEMALE CALL HISTORY
// =====================



// =====================
// FEMALE CALL HISTORY
// =====================


const UNANSWERED_CALL_STATUSES = [
"missed",
"cancelled"
];

const buildFemaleMissedCallsWhere =
async(userId)=>{
const blockedIds =
await getBlockedPeerIds(userId);

const blockedCallerIds =
[...blockedIds];

const whereClause = {
 receiverId:userId,
 status:{
  [Op.in]:UNANSWERED_CALL_STATUSES
 }
};

if(blockedCallerIds.length > 0){
 whereClause.callerId = {
  [Op.notIn]:blockedCallerIds
 };
}

return whereClause;
};

export const getFemaleMissedCallSummary =
async(req,res)=>{

try{

const {
 userId
}
=
req.params;

const whereClause =
await buildFemaleMissedCallsWhere(userId);

const sinceRaw =
req.query.since;

if(sinceRaw){
 const sinceDate =
 new Date(String(sinceRaw));

 if(!Number.isNaN(sinceDate.getTime())){
  whereClause.createdAt = {
   [Op.gt]:sinceDate
  };
 }
}

const totalMissed =
await CallHistory.count({
 where:whereClause
});

return res.json({
 totalMissed
});

}catch(error){

console.log(
"FEMALE MISSED CALL SUMMARY ERROR",
error
);

return res.status(500)
.json({
 message:error.message
});

}

};

export const getFemaleMissedCalls =
async(req,res)=>{

try{

const {
 userId
}
=
req.params;

const page =
Math.max(
1,
parseInt(req.query.page,10) || 1
);

const limit =
Math.min(
50,
Math.max(
1,
parseInt(req.query.limit,10) || 20
)
);

const offset =
(page - 1) * limit;

const whereClause =
await buildFemaleMissedCallsWhere(userId);

const [
 missedCalls,
 total
]=
await Promise.all([

CallHistory.findAll({

where:whereClause,

include:[
 {
  model:User,
  as:"caller",
  required:true,
  attributes:[
   "id",
   "username",
   "avatar"
  ]
 }
],

order:[
 [
  "createdAt",
  "DESC"
 ]
],

limit,
offset

}),

CallHistory.count({
 where:whereClause
})

]);

return res.json({
 missedCalls,
 total,
 page,
 limit,
 hasMore:
 offset + missedCalls.length < total
});

}catch(error){

console.log(
"FEMALE MISSED CALLS ERROR",
error
);

return res.status(500)
.json({
 message:error.message
});

}

};

export const getFemaleCallHistory =
async(req,res)=>{


try{


const {
 userId
}
=
req.params;

const page =
Math.max(
1,
parseInt(req.query.page,10) || 1
);

const limit =
Math.min(
50,
Math.max(
1,
parseInt(req.query.limit,10) || 20
)
);

const offset =
(page - 1) * limit;

const blockedIds =
await getBlockedPeerIds(userId);

const blockedCallerIds =
[...blockedIds];

const whereClause = {
 receiverId:userId
};

if(blockedCallerIds.length > 0){
 whereClause.callerId = {
  [Op.notIn]:blockedCallerIds
 };
}

const requestedType =
String(req.query.type ?? "all").toLowerCase();

if(
requestedType === "audio" ||
requestedType === "voice"
){
 whereClause.type = {
  [Op.in]:["voice","audio"]
 };
}else if(requestedType === "video"){
 whereClause.type = "video";
}

const [
 history,
 total,
 totalEarnings
]=
await Promise.all([

CallHistory.findAll({

where:whereClause,

include:[

{
 model:User,

 as:"caller",

 required:true,

 attributes:[
  "id",
  "username",
  "avatar"
 ]

},

{
 model:Earning,

 as:"earning",

 attributes:[
  "coins",
  "amount",
  "duration",
  "createdAt"
 ]

}

],

order:[
 [
  "createdAt",
  "DESC"
 ]
],

limit,
offset

}),

CallHistory.count({
 where:whereClause
}),

Earning.sum(
 "amount",
 {
  where:{
   userId
  }
 }
)

]);

const lifetimeEarnings =
Number(totalEarnings || 0);

return res.json({

history,

total,

totalEarnings:lifetimeEarnings,

page,

limit,

hasMore:
offset + history.length < total

});





}catch(error){


console.log(
"FEMALE CALL HISTORY ERROR",
error
);



return res.status(500)
.json({

message:error.message

});


}



};