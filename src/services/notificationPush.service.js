import { Expo } from "expo-server-sdk";

import {
Favorite,
User,
DeviceToken,
NotificationRecord
} from "../models/index.js";

const expo =
new Expo();

const recentAlerts =
new Map();

const ALERT_COOLDOWN_MS =
60_000;

let ioRef =
null;

let onlineUsersRef =
null;

export const initNotificationPush =
(io,onlineUsers)=>{
ioRef =
io;

onlineUsersRef =
onlineUsers;
};

const alertKey =
(femaleId,maleId)=>
`${femaleId}:${maleId}`;

const shouldSkipAlert =
(femaleId,maleId)=>{
const key =
alertKey(
femaleId,
maleId
);

const lastSent =
recentAlerts.get(key);

if(
lastSent &&
Date.now() - lastSent <
ALERT_COOLDOWN_MS
){
return true;
}

recentAlerts.set(
key,
Date.now()
);

return false;
};

const saveNotification =
async(
userId,
payload
)=>{
try{
return await NotificationRecord.create({
userId,
title:payload.title,
message:payload.body,
type:payload.data?.type ?? "system",
data:payload.data ?? {},
read:false
});
}catch(error){
console.log(
"SAVE NOTIFICATION ERROR",
error.message
);

return null;
}
};

const sendExpoPush =
async(
tokens,
payload
)=>{
const validTokens =
tokens.filter(
token=>
token &&
Expo.isExpoPushToken(token)
);

if(!validTokens.length){
return;
}

const messages =
validTokens.map(
token=>({
to:token,
sound:"default",
title:payload.title,
body:payload.body,
data:payload.data ?? {},
priority:"high",
channelId:"dating-app-alerts"
})
);

const chunks =
expo.chunkPushNotifications(
messages
);

for(
const chunk of chunks
){
try{
const tickets =
await expo.sendPushNotificationsAsync(
chunk
);

console.log(
"EXPO PUSH TICKETS",
tickets
);
}catch(error){
console.log(
"EXPO PUSH ERROR",
error.message
);
}
}
};

const sendPushToUser =
async(
userId,
payload
)=>{
try{
const tokens =
await DeviceToken.findAll({
where:{
userId
}
});

if(!tokens.length){
return;
}

const expoTokens =
tokens
.map(
row=>row.expoPushToken
)
.filter(Boolean);

await sendExpoPush(
expoTokens,
payload
);
}catch(error){
console.log(
"PUSH TO USER ERROR",
userId,
error.message
);
}
};

const emitToUser =
(userId,event,payload)=>{
if(
!ioRef ||
!onlineUsersRef
){
return false;
}

const keys = [
String(userId),
Number(userId),
userId
].map((value)=>String(value));

const uniqueKeys = [...new Set(keys)];
let emitted = false;

for(const key of uniqueKeys){
const socketId =
onlineUsersRef.get(key);

if(!socketId){
continue;
}

ioRef
.to(socketId)
.emit(
event,
payload
);
emitted = true;
}

return emitted;
};

export const notifyMalesWhenFemaleOnline =
async(
femaleUserId,
options = {}
)=>{
const femaleId =
Number(femaleUserId);

if(
!Number.isFinite(femaleId)
){
return {
notified:0
};
}

const female =
await User.findByPk(
femaleId
);

if(!female){
return {
notified:0
};
}

const displayName =
female.username ||
female.name ||
"Creator";

const payload = {
userId:
String(femaleId),
femaleId,
id:femaleId,
status:"online",
online:true,
name:displayName,
username:female.username
};

if(
ioRef &&
options.broadcastStatus !== false
){
ioRef.emit(
"user-status-changed",
payload
);
}

const favorites =
await Favorite.findAll({
where:{
favoriteUserId:femaleId
}
});

let notified =
0;

for(
const favorite of favorites
){
const maleId =
Number(favorite.userId);

if(
shouldSkipAlert(
femaleId,
maleId
)
){
continue;
}

notified++;

emitToUser(
maleId,
"favorite-online",
payload
);

const pushPayload = {
title:
`${displayName} is online`,
body:
"Your favourite creator is available now.",
data:{
type:"favorite_online",
userId:femaleId
}
};

await sendPushToUser(
maleId,
pushPayload
);

await saveNotification(
maleId,
pushPayload
);
}

console.log(
"FAVORITE ONLINE NOTIFIED",
{
femaleId,
notified
}
);

return {
notified
};
};

export const notifyFemalesOnBroadcast =
async(
broadcast
)=>{
const females =
await User.findAll({
where:{
gender:"Female"
},
attributes:["id","username","name"]
});

const payload = {
id:broadcast.id,
title:broadcast.title,
message:broadcast.message,
type:broadcast.type ?? "broadcast"
};

let notified =
0;

for(
const female of females
){
notified++;

emitToUser(
female.id,
"broadcast-created",
payload
);

const pushPayload = {
title:broadcast.title,
body:broadcast.message,
data:{
type:"broadcast",
broadcastId:broadcast.id
}
};

await sendPushToUser(
female.id,
pushPayload
);

await saveNotification(
female.id,
pushPayload
);
}

if(ioRef){
ioRef.emit(
"broadcast-message",
payload
);
}

console.log(
"BROADCAST NOTIFIED",
{
broadcastId:broadcast.id,
notified
}
);

return {
notified
};
};

export const notifyKycApproved =
async(
userId
)=>{
const id =
Number(userId);

if(
!Number.isFinite(id)
){
return {
notified:false
};
}

const pushPayload = {
title:
"Bank account verified",
body:
"Your KYC is approved. You can now withdraw your earnings.",
data:{
type:"kyc_approved",
userId:id,
screen:"/female/withdraw"
}
};

 // Persist first so Notifications screen always has it.
const saved =
await saveNotification(
id,
pushPayload
);

const realtimePayload = {
...pushPayload,
id:saved?.id ?? null,
notificationId:saved?.id ?? null,
type:"kyc_approved",
message:pushPayload.body,
userId:id,
screen:"/female/withdraw"
};

const socketEmitted =
emitToUser(
id,
"kyc-approved",
realtimePayload
) ||
emitToUser(
id,
"notification",
realtimePayload
);

await sendPushToUser(
id,
pushPayload
);

console.log(
"KYC APPROVED NOTIFIED",
{
userId:id,
saved:Boolean(saved),
notificationId:saved?.id ?? null,
socketEmitted
}
);

return {
notified:true,
saved:Boolean(saved),
socketEmitted
};
};

export const notifyFemaleAccountApproved =
async(
userId
)=>{
const id =
Number(userId);

if(
!Number.isFinite(id)
){
return {
notified:false
};
}

const pushPayload = {
title:
"Profile approved",
body:
"Your account is approved. Go online and start earning by receiving calls.",
data:{
type:"account_approved",
userId:id,
screen:"/female/dashboard"
}
};

const saved =
await saveNotification(
id,
pushPayload
);

const realtimePayload = {
...pushPayload,
id:saved?.id ?? null,
notificationId:saved?.id ?? null,
type:"account_approved",
message:pushPayload.body,
userId:id,
screen:"/female/dashboard"
};

const socketEmitted =
emitToUser(
id,
"account-approved",
realtimePayload
) ||
emitToUser(
id,
"notification",
realtimePayload
);

await sendPushToUser(
id,
pushPayload
);

console.log(
"FEMALE ACCOUNT APPROVED NOTIFIED",
{
userId:id,
saved:Boolean(saved),
notificationId:saved?.id ?? null,
socketEmitted
}
);

return {
notified:true,
saved:Boolean(saved),
socketEmitted
};
};

