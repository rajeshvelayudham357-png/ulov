import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Expo } from "expo-server-sdk";
import {
cert,
getApps,
initializeApp
} from "firebase-admin/app";
import {
getMessaging
} from "firebase-admin/messaging";

import {
Favorite,
User,
DeviceToken,
NotificationRecord
} from "../models/index.js";

const __filename =
fileURLToPath(import.meta.url);

const __dirname =
path.dirname(__filename);

const backendRoot =
path.resolve(
__dirname,
"../.."
);

const expoAccessToken =
process.env.EXPO_ACCESS_TOKEN ||
undefined;

const expo =
new Expo(
expoAccessToken
?
{
accessToken:expoAccessToken
}
:
undefined
);

let firebaseMessaging =
null;

const resolveServiceAccountPath =
(rawPath)=>{
const cleaned =
String(rawPath || "")
.trim()
.replace(/^['"]|['"]$/g, "");

if(!cleaned){
return "";
}

if(
path.isAbsolute(cleaned)
){
return cleaned;
}

return path.resolve(
backendRoot,
cleaned
);
};

const getFirebaseMessaging =
()=>{
if(firebaseMessaging){
return firebaseMessaging;
}

try{
const serviceAccountPath =
resolveServiceAccountPath(
process.env.FIREBASE_SERVICE_ACCOUNT_PATH
);

const serviceAccountJson =
process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if(
!serviceAccountPath &&
!serviceAccountJson
){
return null;
}

if(
serviceAccountPath &&
!fs.existsSync(serviceAccountPath)
){
console.log(
"FIREBASE ADMIN INIT ERROR",
`Service account file not found: ${serviceAccountPath}`
);

return null;
}

const credentials =
serviceAccountJson
?
JSON.parse(serviceAccountJson)
:
JSON.parse(
fs.readFileSync(
serviceAccountPath,
"utf8"
)
);

if(
getApps().length === 0
){
initializeApp({
credential:cert(credentials),
projectId:
credentials.project_id ||
"ulov-4e27d"
});
}

firebaseMessaging =
getMessaging();

console.log(
"FIREBASE ADMIN READY",
{
projectId:credentials.project_id,
clientEmail:credentials.client_email,
path:serviceAccountPath || "inline-json"
}
);

return firebaseMessaging;
}catch(error){
console.log(
"FIREBASE ADMIN INIT ERROR",
error.message
);

return null;
}
};

const recentAlerts =
new Map();

const ALERT_COOLDOWN_MS =
60_000;

const NOTIFICATION_CHANNEL_ID =
"dating-app-alerts";

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

const wasRecentlyAlerted =
(femaleId,maleId)=>{
const key =
alertKey(
femaleId,
maleId
);

const lastSent =
recentAlerts.get(key);

return Boolean(
lastSent &&
Date.now() - lastSent <
ALERT_COOLDOWN_MS
);
};

const markAlerted =
(femaleId,maleId)=>{
recentAlerts.set(
alertKey(
femaleId,
maleId
),
Date.now()
);
};

const saveNotification =
async(
userId,
payload
)=>{
try{
const user =
await User.findByPk(
userId,
{
attributes:[
"id",
"notificationsEnabled"
]
}
);

if(
user &&
user.notificationsEnabled === false
){
return null;
}

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

const toFcmData =
(data = {})=>{
const result = {};

for(
const [key,value] of Object.entries(data)
){
if(
value === undefined ||
value === null
){
continue;
}

result[key] =
typeof value === "string"
?
value
:
JSON.stringify(value);
}

return result;
};

const isLikelyFcmToken =
(token)=>{
const value =
String(token || "").trim();

if(!value){
return false;
}

if(
Expo.isExpoPushToken(value)
){
return false;
}

// Native FCM registration tokens are long opaque strings.
return value.length >= 80;
};

const getFcmServerKey =
()=>
process.env.FCM_SERVER_KEY ||
process.env.FIREBASE_SERVER_KEY ||
process.env.FIREBASE_CLOUD_MESSAGING_KEY ||
"";

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
return {
sent:0,
tickets:[]
};
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
channelId:NOTIFICATION_CHANNEL_ID,
ttl:payload.ttlSeconds ?? 3600,
badge:1
})
);

const chunks =
expo.chunkPushNotifications(
messages
);

const tickets = [];

for(
const chunk of chunks
){
try{
const chunkTickets =
await expo.sendPushNotificationsAsync(
chunk
);

tickets.push(
...chunkTickets
);

console.log(
"EXPO PUSH TICKETS",
chunkTickets
);
}catch(error){
console.log(
"EXPO PUSH ERROR",
error.message
);
}
}

return {
sent:validTokens.length,
tickets
};
};

const sendFcmPushViaAdmin =
async(
tokens,
payload
)=>{
const messaging =
getFirebaseMessaging();

if(!messaging){
return null;
}

let sent =
0;

for(
const token of tokens
){
try{
const response =
await messaging.send({
token,
notification:{
title:payload.title,
body:payload.body
},
data:{
...toFcmData(payload.data),
title:payload.title,
body:payload.body
},
android:{
priority:"high",
ttl:Number(payload.ttlSeconds ?? 3600) * 1000,
notification:{
channelId:NOTIFICATION_CHANNEL_ID,
sound:"default",
priority:"high",
defaultSound:true,
defaultVibrateTimings:true,
visibility:"public"
}
},
// Helps wake Android devices for closed-app delivery.
fcmOptions:{
analyticsLabel:"favorite_online"
},
apns:{
headers:{
"apns-priority":"10"
},
payload:{
aps:{
sound:"default",
badge:1
}
}
}
});

sent++;

console.log(
"FCM ADMIN PUSH RESULT",
response
);
}catch(error){
const code =
error?.errorInfo?.code ||
error?.code ||
"";

console.log(
"FCM ADMIN PUSH ERROR",
code || error.message
);

if(
String(code).includes("registration-token-not-registered") ||
String(code).includes("invalid-registration-token")
){
await DeviceToken.destroy({
where:{
devicePushToken:token
}
});
}
}
}

return {
sent
};
};

const sendFcmPushViaLegacy =
async(
tokens,
payload
)=>{
const serverKey =
getFcmServerKey();

if(!serverKey){
return null;
}

let sent =
0;

for(
const token of tokens
){
try{
const response =
await axios.post(
"https://fcm.googleapis.com/fcm/send",
{
to:token,
priority:"high",
content_available:true,
time_to_live:payload.ttlSeconds ?? 3600,
notification:{
title:payload.title,
body:payload.body,
sound:"default",
android_channel_id:NOTIFICATION_CHANNEL_ID
},
data:{
...toFcmData(payload.data),
title:payload.title,
body:payload.body
}
},
{
headers:{
Authorization:`key=${serverKey}`,
"Content-Type":"application/json"
},
timeout:15000
}
);

sent++;

console.log(
"FCM LEGACY PUSH RESULT",
{
success:response.data?.success,
failure:response.data?.failure,
message_id:response.data?.message_id,
results:response.data?.results
}
);

const errorCode =
response.data?.results?.[0]?.error;

if(
errorCode === "NotRegistered" ||
errorCode === "InvalidRegistration"
){
await DeviceToken.destroy({
where:{
devicePushToken:token
}
});
}
}catch(error){
console.log(
"FCM LEGACY PUSH ERROR",
error.response?.data || error.message
);
}
}

return {
sent
};
};

const sendFcmPush =
async(
tokens,
payload
)=>{
const validTokens =
[...new Set(
tokens
.map((token)=>String(token || "").trim())
.filter(isLikelyFcmToken)
)];

if(!validTokens.length){
return {
sent:0
};
}

const adminResult =
await sendFcmPushViaAdmin(
validTokens,
payload
);

if(adminResult){
return adminResult;
}

const legacyResult =
await sendFcmPushViaLegacy(
validTokens,
payload
);

if(legacyResult){
return legacyResult;
}

console.log(
"FCM PUSH SKIPPED: add FIREBASE_SERVICE_ACCOUNT_PATH (recommended) or FCM_SERVER_KEY in dating-backend/src/config/.env. Native device tokens exist but closed-app push cannot be delivered without Firebase credentials."
);

return {
sent:0,
skipped:validTokens.length
};
};

const sendPushToUser =
async(
userId,
payload
)=>{
try{
const user =
await User.findByPk(
userId,
{
attributes:[
"id",
"notificationsEnabled"
]
}
);

if(
user &&
user.notificationsEnabled === false
){
console.log(
"PUSH SKIPPED: notifications disabled",
{
userId
}
);

return {
expoSent:0,
fcmSent:0
};
}

const tokens =
await DeviceToken.findAll({
where:{
userId
}
});

if(!tokens.length){
console.log(
"PUSH SKIPPED: no device tokens",
{
userId
}
);

return {
expoSent:0,
fcmSent:0
};
}

const expoTokens =
tokens
.map(
row=>row.expoPushToken
)
.filter(Boolean);

const fcmTokens =
tokens
.map(
row=>row.devicePushToken
)
.filter(Boolean);

const expoResult =
await sendExpoPush(
expoTokens,
payload
);

const fcmResult =
await sendFcmPush(
fcmTokens,
payload
);

console.log(
"PUSH TO USER",
{
userId,
expoTokens:expoTokens.length,
fcmTokens:fcmTokens.length,
expoSent:expoResult.sent,
fcmSent:fcmResult.sent,
title:payload.title
}
);

return {
expoSent:expoResult.sent,
fcmSent:fcmResult.sent
};
}catch(error){
console.log(
"PUSH TO USER ERROR",
userId,
error.message
);

return {
expoSent:0,
fcmSent:0
};
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
notified:0,
pushSent:0
};
}

const female =
await User.findByPk(
femaleId
);

if(!female){
return {
notified:0,
pushSent:0
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

let pushSent =
0;

for(
const favorite of favorites
){
const maleId =
Number(favorite.userId);

if(
!Number.isFinite(maleId)
){
continue;
}

if(
!options.ignoreCooldown &&
wasRecentlyAlerted(
femaleId,
maleId
)
){
console.log(
"FAVORITE ONLINE SKIPPED COOLDOWN",
{
femaleId,
maleId
}
);
continue;
}

notified++;

// Realtime if male app is open.
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
femaleId:String(femaleId),
userId:String(femaleId),
status:"online"
},
// Keep closed-app / tray notifications alive longer.
ttlSeconds:7200
};

// Push for closed / background male apps (FCM + Expo).
const pushResult =
await sendPushToUser(
maleId,
pushPayload
);

const malePushCount =
Number(pushResult?.expoSent || 0) +
Number(pushResult?.fcmSent || 0);

pushSent +=
malePushCount;

await saveNotification(
maleId,
pushPayload
);

markAlerted(
femaleId,
maleId
);

console.log(
"FAVORITE ONLINE MALE NOTIFY",
{
femaleId,
maleId,
expoSent:pushResult?.expoSent || 0,
fcmSent:pushResult?.fcmSent || 0
}
);
}

console.log(
"FAVORITE ONLINE NOTIFIED",
{
femaleId,
favorites:favorites.length,
notified,
pushSent,
ignoreCooldown:Boolean(
options.ignoreCooldown
)
}
);

return {
notified,
pushSent,
favorites:favorites.length
};
};

export const notifyUsersAdminMessage =
async({
userIds,
title,
message,
expiresAt = null,
closable = true,
adminNotifyId = null,
templateKey = null,
action = null,
compositionMode = "manual",
emoji = null
})=>{
const uniqueIds = [
...new Set(
(Array.isArray(userIds) ? userIds : [])
.map((value)=>Number(value))
.filter((value)=>Number.isFinite(value))
)
];

const meta = {
type:"admin_notify",
adminNotifyId,
expiresAt,
closable:closable !== false,
popup:true,
templateKey:
templateKey ||
null,
action:
action ||
null,
compositionMode:
compositionMode ||
"manual",
emoji:
emoji ||
null
};

const payload = {
id:adminNotifyId,
title,
message,
expiresAt,
closable:closable !== false,
type:"admin_notify",
popup:true,
templateKey:
templateKey ||
null,
action:
action ||
null,
compositionMode:
compositionMode ||
"manual",
emoji:
emoji ||
null
};

let notified = 0;
let pushSent = 0;

for(const userId of uniqueIds){
notified++;

emitToUser(
userId,
"admin-notify",
payload
);

const pushPayload = {
title,
body:message,
data:{
type:"admin_notify",
adminNotifyId:
adminNotifyId == null
?
""
:
String(adminNotifyId),
expiresAt:
expiresAt
?
String(expiresAt)
:
"",
closable:
closable !== false
?
"true"
:
"false",
popup:"true",
title,
message,
templateKey:
templateKey
?
String(templateKey)
:
"",
action:
action
?
String(action)
:
"",
compositionMode:
compositionMode
?
String(compositionMode)
:
"manual",
emoji:
emoji
?
String(emoji)
:
""
}
};

const pushResult =
await sendPushToUser(
userId,
pushPayload
);

pushSent +=
Number(pushResult?.expoSent || 0) +
Number(pushResult?.fcmSent || 0);

await saveNotification(
userId,
{
title,
body:message,
data:meta
}
);
}

console.log(
"ADMIN NOTIFY SENT",
{
adminNotifyId,
notified,
pushSent
}
);

return {
notified,
pushSent
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

export const notifyIncomingCall =
async(
data = {}
)=>{
const receiverId =
Number(data.receiverId);

const callerId =
Number(data.callerId);

if(
!Number.isFinite(receiverId)
){
return {
notified:false
};
}

let callerName =
data.callerName ||
data.name ||
"Incoming call";

try{
if(
Number.isFinite(callerId)
){
const caller =
await User.findByPk(
callerId,
{
attributes:["id","username","name","nickname"]
}
);

if(caller){
callerName =
caller.nickname ||
caller.username ||
caller.name ||
callerName;
}
}
}catch{
 // Keep fallback caller name.
}

const callType =
String(data.callType || data.type || "voice").toLowerCase();

const pushPayload = {
title:
"Incoming call",
body:
`${callerName} is calling you (${callType})`,
ttlSeconds:60,
data:{
type:"incoming_call",
callerId,
receiverId,
callType,
channelName:data.channelName || "",
screen:"/call"
}
};

const pushResult =
await sendPushToUser(
receiverId,
pushPayload
);

await saveNotification(
receiverId,
pushPayload
);

console.log(
"INCOMING CALL PUSH",
{
receiverId,
callerId,
...pushResult
}
);

return {
notified:true,
...pushResult
};
};
