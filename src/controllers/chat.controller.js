import { Op } from "sequelize";

import {
getMessageText,
isAllowedMessageKey
} from "../constants/chatMessages.js";
import {
ChatMessage,
Favorite,
User
} from "../models/index.js";
import {
emitChatMessage
} from "../services/chatRealtime.service.js";
import {
notifyChatMessage
} from "../services/notificationPush.service.js";
import {
areUsersBlocked,
getBlockedPeerIds
} from "../services/block.service.js";
import { GROWTH_EVENT_NAMES } from "../constants/growthEventDefinitions.js";
import { trackGrowthEventAsync } from "../services/growthEvents.service.js";

const twoDaysAgo =
()=>
new Date(
Date.now() -
2 *
24 *
60 *
60 *
1000
);

const formatMessage =
(row)=>{
const data =
row.toJSON ?
row.toJSON() :
row;

return {
id:data.id,
senderId:Number(data.senderId),
receiverId:Number(data.receiverId),
messageKey:data.messageKey,
messageText:data.messageText,
read:Boolean(data.read),
createdAt:data.createdAt
};
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

const canSendChat =
async(
senderId,
receiverId
)=>{
const sender =
Number(senderId);

const receiver =
Number(receiverId);

const blocked =
await areUsersBlocked(
sender,
receiver
);

if(blocked){
return false;
}

const senderUser =
await User.findByPk(
sender,
{
attributes:["id","gender"]
}
);

if(!senderUser){
return false;
}

if(senderUser.gender === "Female"){
return true;
}

const maleToFemale =
await Favorite.findOne({
where:{
userId:sender,
favoriteUserId:receiver
}
});

if(maleToFemale){
return true;
}

const maleFavoritedFemale =
await Favorite.findOne({
where:{
userId:receiver,
favoriteUserId:sender
}
});

if(maleFavoritedFemale){
return true;
}

const receiverUser =
await User.findByPk(
receiver,
{
attributes:["id","gender"]
}
);

if(receiverUser?.gender === "Female"){
const femaleStartedChat =
await ChatMessage.findOne({
where:{
senderId:receiver,
receiverId:sender,
createdAt:{
[Op.gte]:twoDaysAgo()
}
}
});

if(femaleStartedChat){
return true;
}
}

return false;
};

export const sendMessage =
async(req,res)=>{

try{

const {
senderId,
receiverId,
messageKey
}=req.body;

if(
!senderId ||
!receiverId ||
!messageKey
){
return res.status(400).json({
message:"senderId, receiverId and messageKey are required"
});
}

const sender =
await User.findByPk(
senderId,
{
attributes:["id","gender","username","name","avatar"]
}
);

if(!sender){
return res.status(404).json({
message:"Sender not found"
});
}

const blocked =
await areUsersBlocked(
senderId,
receiverId
);

if(blocked){
return res.status(403).json({
message:"Chat is not available with this user"
});
}

if(
!isAllowedMessageKey(
sender.gender,
messageKey
)
){
return res.status(400).json({
message:"Invalid message tile for this user"
});
}

const allowed =
await canSendChat(
senderId,
receiverId
);

if(!allowed){
return res.status(403).json({
message:"Chat is only available with favourite users"
});
}

const message =
await ChatMessage.create({
senderId:Number(senderId),
receiverId:Number(receiverId),
messageKey,
messageText:
getMessageText(messageKey),
read:false
});

const payload =
formatMessage(message);

emitChatMessage(
receiverId,
payload
);

emitChatMessage(
senderId,
payload
);

notifyChatMessage({
receiverId:Number(receiverId),
senderId:Number(senderId),
senderName:getDisplayName(sender),
messageText:payload.messageText,
senderAvatar:sender.avatar
}).catch((error)=>{
console.log(
"CHAT NOTIFY ERROR",
error
);
});

trackGrowthEventAsync({
  eventName: GROWTH_EVENT_NAMES.CHAT_STARTED,
  userId: Number(senderId),
  creatorId: Number(receiverId),
  metadata: {
    senderId: Number(senderId),
    receiverId: Number(receiverId),
    messageKey,
  },
});

return res.status(201).json({
success:true,
message:payload
});

}catch(error){

console.log(
"SEND CHAT ERROR",
error
);

return res.status(500).json({
message:error.message
});

}

};

export const getConversation =
async(req,res)=>{

try{

const {
userId,
peerId
}=req.params;

const blocked =
await areUsersBlocked(
userId,
peerId
);

if(blocked){
return res.status(403).json({
message:"Chat is not available with this user"
});
}

const allowed =
await canSendChat(
userId,
peerId
) ||
await canSendChat(
peerId,
userId
);

if(!allowed){
return res.status(403).json({
message:"Chat is only available with favourite users"
});
}

const cutoff =
twoDaysAgo();

const messages =
await ChatMessage.findAll({
where:{
createdAt:{
[Op.gte]:cutoff
},
[Op.or]:[
{
senderId:Number(userId),
receiverId:Number(peerId)
},
{
senderId:Number(peerId),
receiverId:Number(userId)
}
]
},
order:[
["createdAt","ASC"]
]
});

await ChatMessage.update(
{
read:true
},
{
where:{
senderId:Number(peerId),
receiverId:Number(userId),
read:false,
createdAt:{
[Op.gte]:cutoff
}
}
}
);

return res.json({
messages:
messages.map(formatMessage)
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const getConversations =
async(req,res)=>{

try{

const {
userId
}=req.params;

const user =
await User.findByPk(
userId,
{
attributes:["id","gender"]
}
);

if(!user){
return res.status(404).json({
message:"User not found"
});
}

const cutoff =
twoDaysAgo();

const blockedIds =
await getBlockedPeerIds(userId);

const recentMessages =
await ChatMessage.findAll({
where:{
createdAt:{
[Op.gte]:cutoff
},
[Op.or]:[
{ senderId:Number(userId) },
{ receiverId:Number(userId) }
]
},
order:[
["createdAt","DESC"]
]
});

const latestByPeer =
new Map();

for(
const message of recentMessages
){
const peerId =
Number(message.senderId) ===
Number(userId)
?
Number(message.receiverId)
:
Number(message.senderId);

if(blockedIds.has(peerId)){
continue;
}

const key =
String(peerId);

if(
!latestByPeer.has(key)
){
latestByPeer.set(
key,
message
);
}
}

const conversations = [];

for(
const [
peerId,
latest
] of latestByPeer.entries()
){

const favoriteOk =
await canSendChat(
userId,
peerId
);

if(!favoriteOk){
continue;
}

const peer =
await User.findByPk(
peerId,
{
attributes:[
"id",
"username",
"name",
"nickname",
"avatar",
"online",
"gender"
]
}
);

if(!peer){
continue;
}

const unreadCount =
await ChatMessage.count({
where:{
senderId:Number(peerId),
receiverId:Number(userId),
read:false,
createdAt:{
[Op.gte]:cutoff
}
}
});

conversations.push({
peer:{
id:peer.id,
username:peer.username,
name:
getDisplayName(peer),
avatar:peer.avatar,
online:peer.online,
gender:peer.gender
},
lastMessage:
formatMessage(latest),
unreadCount
});
}

conversations.sort(
(a,b)=>
new Date(b.lastMessage.createdAt) -
new Date(a.lastMessage.createdAt)
);

return res.json({
conversations
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const purgeOldChatMessages =
async()=>{

const cutoff =
twoDaysAgo();

const deleted =
await ChatMessage.destroy({
where:{
createdAt:{
[Op.lt]:cutoff
}
}
});

if(deleted){
console.log(
"CHAT PURGE",
deleted
);
}

return deleted;
};
