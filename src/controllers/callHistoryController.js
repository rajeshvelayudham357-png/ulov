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
completeCallRecord
} from "../services/callState.service.js";
   
   
   
   // SAVE CALL
   
   
   export const saveCallHistory =
   async(req,res)=>{
   
   
   try{
   
   
   const {
   
   callerId,
   
   receiverId,
   
   type,
   
   duration,
   
   coinsSpent,
   
   callHistoryId,
   
   callId
   
   }=req.body;
   
   
   
   
   
   const {
   history,
   earning,
   alreadyCompleted
   }=
   await completeCallRecord({
   callerId,
   receiverId,
   type,
   duration,
   coinsSpent,
   callHistoryId:
   callHistoryId ??
   callId
   });
   
   
   
   
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