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

const FEMALE_GENDERS = [
"Female",
"female",
"FEMALE"
];

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
limit:100,
raw:true
});

const userIds =
aggregates
.map(
(item)=>
Number(item.userId)
)
.filter(
Number.isFinite
);

if(
userIds.length === 0
){
return res.json({
leaderboard:[]
});
}

const userWhere = {
id:{
[Op.in]:userIds
}
};

if(
genderFilter === "female"
){
userWhere.gender = {
[Op.in]:FEMALE_GENDERS
};
}

const creators =
await User.findAll({
where:userWhere,
attributes:[
"id",
"username",
"nickname",
"name",
"avatar",
"online",
"gender"
]
});

const creatorMap =
new Map(
creators.map(
(creator)=>[
creator.id,
creator.toJSON()
]
)
);

const data =
aggregates
.filter(
(item)=>
creatorMap.has(Number(item.userId))
)
.map(
(item,index)=>({
rank:index + 1,
userId:Number(item.userId),
totalGold:Number(item.totalGold) || 0,
totalCalls:Number(item.totalCalls) || 0,
reward:
index === 0
?
500
:
index === 1
?
300
:
index === 2
?
100
:
0,
trend:Math.floor(Math.random() * 10),
creator:creatorMap.get(Number(item.userId)) ?? null
}))
.slice(0, 50);

return res.json({
leaderboard:data
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
