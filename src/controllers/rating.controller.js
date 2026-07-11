import {
getRemarkKeysForCallType,
getRemarkText,
isAllowedRemarkKey,
isValidRating,
RATING_LABELS
} from "../constants/callRatings.js";
import {
CallHistory,
CallRating,
User
} from "../models/index.js";
import {
fn,
col
} from "sequelize";

const RATING_SCORES = {
very_bad:1,
bad:2,
average:3,
good:4,
very_good:5
};

const getDisplayName =
(user)=>{
const name =
user.name?.trim();

const username =
user.username?.trim();

const nickname =
user.nickname?.trim();

if(
name &&
name !== "New User"
){
return name;
}

if(username){
return username;
}

if(nickname){
return nickname;
}

return name || "User";
};

const formatRatingRow =
(row)=>{
const data =
row.toJSON ?
row.toJSON() :
row;

const caller =
data.caller ?
data.caller :
null;

const remarkKeys =
Array.isArray(data.remarkKeys)
? data.remarkKeys
: [];

return {
id:Number(data.id),
callHistoryId:data.callHistoryId
? Number(data.callHistoryId)
: null,
callerId:Number(data.callerId),
femaleId:Number(data.femaleId),
callType:data.callType,
rating:data.rating,
ratingLabel:RATING_LABELS[data.rating] ?? data.rating,
remarkKeys,
remarks:remarkKeys.map(
(key)=>({
 key,
 text:getRemarkText(key)
})
),
createdAt:data.createdAt,
caller:caller
? {
 id:Number(caller.id),
 name:getDisplayName(caller),
 username:caller.username,
 avatar:caller.avatar,
 verified:Boolean(caller.verified)
}
: null
};
};

export const submitCallRating =
async(req,res)=>{
try{
const {
callerId,
femaleId,
callType,
rating,
remarkKeys,
callHistoryId
}=req.body;

if(
!callerId ||
!femaleId ||
!callType ||
!rating
){
return res.status(400).json({
 message:"callerId, femaleId, callType and rating are required"
});
}

if(!isValidRating(rating)){
return res.status(400).json({
 message:"Invalid rating value"
});
}

const normalizedCallType =
callType === "voice"
? "audio"
: callType;

if(
normalizedCallType !== "audio" &&
normalizedCallType !== "video"
){
return res.status(400).json({
 message:"callType must be audio or video"
});
}

const keys =
Array.isArray(remarkKeys)
? remarkKeys
: [];

const allowedKeys =
getRemarkKeysForCallType(normalizedCallType);

for(const key of keys){
if(!isAllowedRemarkKey(normalizedCallType,key)){
return res.status(400).json({
 message:`Invalid remark key: ${key}`
});
}
}

const uniqueKeys =
[...new Set(keys.filter(Boolean))];

const caller =
await User.findByPk(callerId);

const female =
await User.findByPk(femaleId);

if(!caller || !female){
return res.status(404).json({
 message:"User not found"
});
}

if(
String(caller.gender ?? "").toLowerCase() !== "male"
){
return res.status(403).json({
 message:"Only male users can submit call ratings"
});
}

if(
String(female.gender ?? "").toLowerCase() !== "female"
){
return res.status(400).json({
 message:"Ratings can only be submitted for female users"
});
}

if(Number(callerId) === Number(femaleId)){
return res.status(400).json({
 message:"Invalid rating target"
});
}

let historyId =
callHistoryId ?
Number(callHistoryId) :
null;

if(historyId){
const history =
await CallHistory.findByPk(historyId);

if(
!history ||
Number(history.callerId) !== Number(callerId) ||
Number(history.receiverId) !== Number(femaleId)
){
return res.status(400).json({
 message:"Invalid call history reference"
});
}
}else{
const latestCall =
await CallHistory.findOne({
 where:{
 callerId,
 receiverId:femaleId,
 status:"completed"
 },
 order:[
 ["createdAt","DESC"]
 ]
});

historyId =
latestCall?.id ?? null;
}

if(historyId){
const existing =
await CallRating.findOne({
 where:{
 callerId,
 callHistoryId:historyId
 }
});

if(existing){
return res.status(409).json({
 message:"You already rated this call",
 rating:formatRatingRow(existing)
});
}
}

const created =
await CallRating.create({
 callHistoryId:historyId,
 callerId,
 femaleId,
 callType:normalizedCallType,
 rating,
 remarkKeys:uniqueKeys
});

const full =
await CallRating.findByPk(
created.id,
{
 include:[
 {
 model:User,
 as:"caller",
 attributes:[
 "id",
 "name",
 "username",
 "nickname",
 "avatar",
 "verified"
 ]
 }
 ]
}
);

return res.status(201).json({
 success:true,
 rating:formatRatingRow(full)
});
}catch(error){
return res.status(500).json({
 message:error.message
});
}
};

export const getFemaleCallRatings =
async(req,res)=>{
try{
const {
femaleUserId
}=req.params;

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

const female =
await User.findByPk(femaleUserId);

if(!female){
return res.status(404).json({
 message:"User not found"
});
}

if(
String(female.gender ?? "").toLowerCase() !== "female"
){
return res.status(400).json({
 message:"Ratings are available for female users only"
});
}

const ratingWhere = {
 femaleId:femaleUserId
};

const [
rows,
total,
ratingGroups
]=
await Promise.all([

CallRating.findAll({
 where:ratingWhere,
 include:[
 {
 model:User,
 as:"caller",
 attributes:[
  "id",
  "name",
  "username",
  "nickname",
  "avatar",
  "verified"
 ]
 }
 ],
 order:[
 ["createdAt","DESC"]
 ],
 limit,
 offset
}),

CallRating.count({
 where:ratingWhere
}),

CallRating.findAll({
 where:ratingWhere,
 attributes:[
  "rating",
  [fn("COUNT",col("id")),"count"]
 ],
 group:["rating"],
 raw:true
})

]);

const ratings =
rows.map(formatRatingRow);

const summary = {
 total:0,
 byRating:{},
 averageScore:null
};

let weightedSum = 0;

ratingGroups.forEach(
(group)=>{
const count =
Number(group.count ?? 0);

const rating =
group.rating;

summary.total += count;
summary.byRating[rating] = count;
weightedSum +=
(RATING_SCORES[rating] ?? 3) * count;
}
);

if(summary.total > 0){
summary.averageScore =
Number(
(weightedSum / summary.total).toFixed(1)
);
}

return res.json({
 success:true,
 total,
 summary,
 ratings,
 page,
 limit,
 hasMore:
 offset + ratings.length < total
});
}catch(error){
return res.status(500).json({
 message:error.message
});
}
};
