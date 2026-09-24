import {
    Earning,
    User
} from "../models/index.js";

import {
    Op,
    fn,
    col,
    literal
} from "sequelize";

import {
    getAppSettings
} from "../services/appSettings.service.js";
import {
    attachUserLevels
} from "../services/userLevel.service.js";
import {
    resolveVisibleProfileFrame,
} from "../services/profileFrame.service.js";

const CREATOR_ATTRIBUTES = [
  "id",
  "username",
  "nickname",
  "name",
  "avatar",
  "online",
  "gender",
  "profileFrameId",
  "profileFrameExpiresAt",
  "purchasedProfileFrames",
];

const serializeLeaderboardCreator = (creator, femaleStoreEnabled = false) => {
  const data = creator?.toJSON ? creator.toJSON() : creator;
  const visible = resolveVisibleProfileFrame(data);
  const showProfileFrame = Boolean(femaleStoreEnabled);

  return {
    ...data,
    profileFrameId: showProfileFrame ? visible.profileFrameId : null,
    profileFrameExpiresAt: showProfileFrame
      ? visible.profileFrameExpiresAt
      : null,
  };
};

const FEMALE_GENDERS = [
"Female",
"female",
"FEMALE"
];

const FEMALE_WHERE = {
gender:{
[Op.in]:FEMALE_GENDERS
}
};

const getPeriodRange =
(type = "today")=>{

const start =
new Date();

const end =
new Date();

if(type === "today"){
start.setHours(0, 0, 0, 0);
return { start, end };
}

if(type === "yesterday"){
start.setDate(start.getDate() - 1);
start.setHours(0, 0, 0, 0);

end.setDate(end.getDate() - 1);
end.setHours(23, 59, 59, 999);

return { start, end };
}

start.setDate(start.getDate() - 7);
start.setHours(0, 0, 0, 0);

return { start, end };
};

const buildLeaderboardEntry =
(entry,index)=>({
rank:
entry.rank === null || entry.rank === undefined
?
null
:
Number(entry.rank) || index + 1,
userId:Number(entry.userId),
totalGold:Number(entry.totalGold) || 0,
totalCalls:Number(entry.totalCalls) || 0,
reward:
!entry.isOnlineExtra &&
index === 0
?
500
:
!entry.isOnlineExtra &&
index === 1
?
300
:
!entry.isOnlineExtra &&
index === 2
?
100
:
0,
trend:Math.floor(Math.random() * 10),
creator:entry.creator ?? null,
userLevel:entry.userLevel ?? entry.creator?.userLevel ?? null,
isOnlineExtra:Boolean(entry.isOnlineExtra)
});

const withCreatorLevels =
async(entries)=>{
  const creators =
  entries
  .map((entry)=>entry.creator)
  .filter(Boolean);

  if(creators.length === 0){
    return entries;
  }

  const leveled =
  await attachUserLevels(creators);

  const byId =
  new Map(
    leveled.map((creator)=>[
      Number(creator.id),
      creator
    ])
  );

  return entries.map((entry)=>{
    const creator =
    entry.creator
    ?
    byId.get(Number(entry.creator.id)) ?? entry.creator
    :
    null;

    return {
      ...entry,
      creator,
      userLevel:creator?.userLevel ?? null
    };
  });
};

export const leaderboard =
async(req,res)=>{

try{

const {
type = "today",
gender = ""
} = req.query;

const { start, end } =
getPeriodRange(String(type));

const genderFilter =
String(gender).toLowerCase();

if(
genderFilter !== "female"
){
return res.json({
leaderboard:[],
topLimit:15
});
}

const settings =
await getAppSettings();

const femaleStoreEnabled =
Boolean(settings.femaleStoreEnabled);

const topLimit =
Math.min(
100,
Math.max(
3,
Number(settings.creatorQueensTopLimit) || 15
)
);

const aggregates =
await Earning.findAll({
attributes:[
"userId",
[
fn(
"SUM",
col("coins")
),
"totalGold"
],
[
fn(
"COUNT",
col("Earning.id")
),
"totalCalls"
]
],
where:{
createdAt:{
[Op.between]:[
start,
end
]
}
},
group:[
"userId"
],
order:[
[
literal("totalGold"),
"DESC"
]
],
limit:500,
raw:true
});

const rankedUserIds =
aggregates
.map(
(item)=>
Number(item.userId)
)
.filter(
Number.isFinite
);

const rankedCreators =
rankedUserIds.length === 0
?
[]
:
await User.findAll({
where:{
...FEMALE_WHERE,
id:{
[Op.in]:rankedUserIds
}
},
attributes: CREATOR_ATTRIBUTES
});

const creatorMap =
new Map(
rankedCreators.map(
(creator)=>[
creator.id,
serializeLeaderboardCreator(creator, femaleStoreEnabled)
]
)
);

const rankedAggregates =
aggregates.filter(
(item)=>
creatorMap.has(Number(item.userId))
);

const topRanked =
rankedAggregates
.slice(0, topLimit)
.map(
(item,index)=>
buildLeaderboardEntry(
{
userId:item.userId,
totalGold:item.totalGold,
totalCalls:item.totalCalls,
creator:creatorMap.get(Number(item.userId)) ?? null,
isOnlineExtra:false
},
index
)
);

const topUserIds =
topRanked.map(
(entry)=>
entry.userId
);

const onlineExtras =
await User.findAll({
where:{
...FEMALE_WHERE,
online:true,
id:{
[Op.notIn]:
topUserIds.length > 0
?
topUserIds
:
[0]
}
},
attributes: CREATOR_ATTRIBUTES
});

const extraUserIds =
onlineExtras
.map(
(creator)=>
Number(creator.id)
)
.filter(
Number.isFinite
);

const extraAggregateMap =
new Map();

if(
extraUserIds.length > 0
){
const extraAggregates =
await Earning.findAll({
attributes:[
"userId",
[
fn(
"SUM",
col("coins")
),
"totalGold"
],
[
fn(
"COUNT",
col("Earning.id")
),
"totalCalls"
]
],
where:{
userId:{
[Op.in]:extraUserIds
},
createdAt:{
[Op.between]:[
start,
end
]
}
},
group:[
"userId"
],
raw:true
});

for(
const item of extraAggregates
){
extraAggregateMap.set(
Number(item.userId),
{
totalGold:Number(item.totalGold) || 0,
totalCalls:Number(item.totalCalls) || 0
}
);
}
}

const rankByUserId =
new Map(
rankedAggregates.map(
(item,index)=>[
Number(item.userId),
index + 1
]
)
);

const onlineExtraEntries =
onlineExtras
.map(
(creator)=>{
const userId =
Number(creator.id);

const stats =
extraAggregateMap.get(userId) ?? {
totalGold:0,
totalCalls:0
};

return buildLeaderboardEntry(
{
userId,
totalGold:stats.totalGold,
totalCalls:stats.totalCalls,
creator:serializeLeaderboardCreator(creator, femaleStoreEnabled),
isOnlineExtra:true,
rank:rankByUserId.get(userId) ?? null
},
0
);
})
.sort(
(a,b)=>
b.totalGold - a.totalGold ||
a.userId - b.userId
);

if(
topRanked.length === 0 &&
onlineExtraEntries.length === 0
){
return res.json({
leaderboard:[],
topLimit
});
}

return res.json({
leaderboard: await withCreatorLevels([
...topRanked,
...onlineExtraEntries
]),
topLimit
});

}catch(error){

console.log(
"LEADERBOARD ERROR",
error
);

return res
.status(500)
.json({
message:error.message
});

}

};
