import { Op } from "sequelize";

import {
getBlockReasonText,
isValidBlockReason
} from "../constants/blockReasons.js";
import {
Block,
Favorite
} from "../models/index.js";

export const getBlockedPeerIds =
async(userId)=>{

const normalized =
Number(userId);

if(!Number.isFinite(normalized)){
return new Set();
}

const rows =
await Block.findAll({

where:{
 [Op.or]:[
  { blockerId:normalized },
  { blockedUserId:normalized }
 ]
},

attributes:[
"blockerId",
"blockedUserId"
],

raw:true

});

const ids =
new Set();

for(const row of rows){

if(Number(row.blockerId) === normalized){
 ids.add(Number(row.blockedUserId));
}

if(Number(row.blockedUserId) === normalized){
 ids.add(Number(row.blockerId));
}

}

return ids;

};

export const areUsersBlocked =
async(
userA,
userB
)=>{

const first =
Number(userA);

const second =
Number(userB);

if(
!Number.isFinite(first) ||
!Number.isFinite(second)
){
return false;
}

const existing =
await Block.findOne({

where:{
 [Op.or]:[
  {
   blockerId:first,
   blockedUserId:second
  },
  {
   blockerId:second,
   blockedUserId:first
  }
 ]
}

});

return Boolean(existing);

};

export const removeMutualFavorites =
async(
userA,
userB
)=>{

await Favorite.destroy({

where:{
 [Op.or]:[
  {
   userId:userA,
   favoriteUserId:userB
  },
  {
   userId:userB,
   favoriteUserId:userA
  }
 ]
}

});

};

export const filterBlockedUsers =
(
users,
blockedIds
)=>{

if(
!blockedIds?.size
){
return users;
}

return users.filter(
(user)=>{
const id =
Number(
user.id ??
user.userId ??
user.profile?.id
);

return !blockedIds.has(id);
}
);

};

export const formatBlockedUserRow =
(row)=>{

const data =
row.toJSON ?
row.toJSON() :
row;

const blockedUser =
data.blockedUser ??
null;

return {
id:Number(data.id),
blockerId:Number(data.blockerId),
blockedUserId:Number(data.blockedUserId),
reasonKey:data.reasonKey,
reasonText:
data.reasonText ??
getBlockReasonText(data.reasonKey),
createdAt:data.createdAt,
blockedUser:blockedUser
? {
 id:Number(blockedUser.id),
 name:blockedUser.name,
 username:blockedUser.username,
 nickname:blockedUser.nickname,
 avatar:blockedUser.avatar,
 gender:blockedUser.gender,
 verified:Boolean(blockedUser.verified)
}
: null
};

};
