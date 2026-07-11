import {
getBlockReasonText,
isValidBlockReason
} from "../constants/blockReasons.js";
import {
Block,
User
} from "../models/index.js";
import {
formatBlockedUserRow,
removeMutualFavorites
} from "../services/block.service.js";

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

export const blockUser =
async(req,res)=>{

try{

const {
blockerId,
blockedUserId,
reasonKey
}=req.body;

if(
!blockerId ||
!blockedUserId ||
!reasonKey
){
return res.status(400).json({
 message:"blockerId, blockedUserId and reasonKey are required"
});
}

if(!isValidBlockReason(reasonKey)){
return res.status(400).json({
 message:"Invalid block reason"
});
}

if(Number(blockerId) === Number(blockedUserId)){
return res.status(400).json({
 message:"You cannot block yourself"
});
}

const blocker =
await User.findByPk(blockerId);

const blockedUser =
await User.findByPk(blockedUserId);

if(!blocker || !blockedUser){
return res.status(404).json({
 message:"User not found"
});
}

const reasonText =
getBlockReasonText(reasonKey);

let block =
await Block.findOne({

where:{
 blockerId,
 blockedUserId
}

});

if(block){

await block.update({
 reasonKey,
 reasonText
});

}else{

block =
await Block.create({
 blockerId,
 blockedUserId,
 reasonKey,
 reasonText
});

}

await removeMutualFavorites(
Number(blockerId),
Number(blockedUserId)
);

const full =
await Block.findByPk(
block.id,
{
 include:[
 {
 model:User,
 as:"blockedUser",
 attributes:[
  "id",
  "name",
  "username",
  "nickname",
  "avatar",
  "gender",
  "verified"
 ]
 }
 ]
}
);

return res.status(201).json({
 success:true,
 blocked:formatBlockedUserRow(full)
});

}catch(error){

return res.status(500).json({
 message:error.message
});

}

};

export const unblockUser =
async(req,res)=>{

try{

const {
blockerId
}=req.body;

const {
blockedUserId
}=req.params;

if(
!blockerId ||
!blockedUserId
){
return res.status(400).json({
 message:"blockerId and blockedUserId are required"
});
}

const block =
await Block.findOne({

where:{
 blockerId,
 blockedUserId
}

});

if(!block){
return res.status(404).json({
 message:"Block record not found"
});
}

await block.destroy();

return res.json({
 success:true,
 message:"User unblocked"
});

}catch(error){

return res.status(500).json({
 message:error.message
});

}

};

export const getBlockedUsers =
async(req,res)=>{

try{

const {
userId
}=req.params;

const user =
await User.findByPk(userId);

if(!user){
return res.status(404).json({
 message:"User not found"
});
}

const rows =
await Block.findAll({

where:{
 blockerId:userId
},

include:[
{
 model:User,
 as:"blockedUser",
 attributes:[
  "id",
  "name",
  "username",
  "nickname",
  "avatar",
  "gender",
  "verified"
 ]
}
],

order:[
 ["createdAt","DESC"]
]

});

const blocked =
rows
.filter(
row=>row.blockedUser
)
.map(
(row)=>{
const formatted =
formatBlockedUserRow(row);

return {
 ...formatted,
 blockedUser:{
  ...formatted.blockedUser,
  name:getDisplayName(formatted.blockedUser)
 }
};
}
);

return res.json({
 success:true,
 total:blocked.length,
 blocked
});

}catch(error){

return res.status(500).json({
 message:error.message
});

}

};
