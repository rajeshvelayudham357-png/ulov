import { Op } from "sequelize";
import { sequelize } from "../config/database.js";
import { User } from "../models/index.js";

let columnReady =
false;

const PUBLIC_ID_MIN =
10000000;

const PUBLIC_ID_RANGE =
90000000;

export const ensurePublicUserIdColumn =
async()=>{

if(columnReady){
return;
}

try{

await sequelize.query(
"SELECT publicUserId FROM users LIMIT 1"
);

}catch(error){

await sequelize.query(
"ALTER TABLE users ADD COLUMN publicUserId VARCHAR(8) NULL"
);

}

try{

await sequelize.query(
"ALTER TABLE users ADD UNIQUE INDEX users_publicUserId_unique (publicUserId)"
);

}catch(error){

// Ignore when the index already exists.

}

columnReady =
true;

};

export const generateUniquePublicUserId =
async()=>{

await ensurePublicUserIdColumn();

for(
let attempt = 0;
attempt < 30;
attempt += 1
){

const value =
String(
PUBLIC_ID_MIN +
Math.floor(
Math.random() * PUBLIC_ID_RANGE
)
);

const existing =
await User.findOne({
where:{
publicUserId:value
},
attributes:[
"id"
]
});

if(!existing){
return value;
}

}

throw new Error(
"Unable to generate unique user ID"
);

};

export const assignPublicUserId =
async(user)=>{

await ensurePublicUserIdColumn();

if(
user.publicUserId
){
return user.publicUserId;
}

const publicUserId =
await generateUniquePublicUserId();

await user.update({
publicUserId
});

user.publicUserId =
publicUserId;

return publicUserId;

};

export const backfillPublicUserIds =
async()=>{

await ensurePublicUserIdColumn();

const users =
await User.findAll({
where:{
[Op.or]:[
{ publicUserId:null },
{ publicUserId:"" }
]
},
attributes:[
"id",
"publicUserId"
],
order:[
[
"id",
"ASC"
]
]
});

for(
const user of users
){

await assignPublicUserId(
user
);

}

return users.length;

};
