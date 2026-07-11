import { col, fn, literal } from "sequelize";

import { CallRating } from "../models/index.js";

export const getFemaleRatingStatsMap =
async()=>{

const rows =
await CallRating.findAll({

attributes:[
"femaleId",
[
fn(
"AVG",
literal(`(
CASE rating
WHEN 'very_bad' THEN 1
WHEN 'bad' THEN 2
WHEN 'average' THEN 3
WHEN 'good' THEN 4
WHEN 'very_good' THEN 5
ELSE NULL
END
)`)
),
"ratingScore"
],
[
fn(
"COUNT",
col("id")
),
"ratingCount"
]
],

group:["femaleId"],

raw:true

});

const map =
new Map();

for(const row of rows){

map.set(
Number(row.femaleId),
{
ratingScore:Number(
Number(row.ratingScore).toFixed(2)
),
ratingCount:Number(row.ratingCount)
}
);

}

return map;

};

export const sortUsersByRating =
(users)=>{

return [...users].sort(
(a,b)=>{

const scoreDiff =
(b.ratingScore ?? 0) -
(a.ratingScore ?? 0);

if(scoreDiff !== 0){
return scoreDiff;
}

const countDiff =
(b.ratingCount ?? 0) -
(a.ratingCount ?? 0);

if(countDiff !== 0){
return countDiff;
}

return Number(b.id) - Number(a.id);

}
);

};
