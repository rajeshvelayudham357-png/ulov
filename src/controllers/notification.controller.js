import {
DeviceToken,
NotificationRecord,
User
} from "../models/index.js";

import {
notifyFemalesOnBroadcast,
notifyMalesWhenFemaleOnline
} from "../services/notificationPush.service.js";

export const registerToken =
async(req,res)=>{

try{

const {
userId,
platform,
devicePushToken,
expoPushToken,
gender
}=req.body;

if(!userId){
return res.status(400).json({
message:"userId required"
});
}

const normalizedUserId =
Number(userId);

const normalizedPlatform =
platform ?? "unknown";

const existing =
await DeviceToken.findOne({
where:{
userId:normalizedUserId,
platform:normalizedPlatform
}
});

const nextDevicePushToken =
String(devicePushToken || "").trim() ||
existing?.devicePushToken ||
"";

const nextExpoPushToken =
String(expoPushToken || "").trim() ||
existing?.expoPushToken ||
"";

const [tokenRecord]=
await DeviceToken.upsert({
userId:normalizedUserId,
platform:normalizedPlatform,
devicePushToken:nextDevicePushToken,
expoPushToken:nextExpoPushToken
});

console.log(
"DEVICE TOKEN REGISTERED",
{
userId,
platform:normalizedPlatform,
hasExpoToken:Boolean(nextExpoPushToken),
hasDeviceToken:Boolean(nextDevicePushToken),
gender
}
);

return res.json({
success:true,
token:tokenRecord
});

}catch(error){

console.log(
"REGISTER TOKEN ERROR",
error
);

return res.status(500).json({
message:error.message
});

}

};

export const syncFavorites =
async(req,res)=>{

try{

const {
userId,
favoriteUserIds = []
}=req.body;

console.log(
"FAVORITE SUBSCRIPTIONS SYNCED",
{
userId,
count:favoriteUserIds.length
}
);

return res.json({
success:true,
userId:Number(userId),
favoriteUserIds
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const favoriteOnline =
async(req,res)=>{

try{

const {
userId,
status = "online",
name
}=req.body;

if(!userId){
return res.status(400).json({
message:"userId required"
});
}

if(status !== "online"){
return res.json({
success:true,
notified:0
});
}

const female =
await User.findByPk(
Number(userId),
{
attributes:[
"id",
"online",
"gender"
]
}
);

if(
!female ||
String(female.gender ?? "").toLowerCase() !== "female" ||
!Boolean(female.online)
){
return res.json({
success:true,
notified:0,
skipped:"not_online"
});
}

// Backup / explicit notify path. Cooldown avoids duplicate tray spam.
const result =
await notifyMalesWhenFemaleOnline(
userId,
{
broadcastStatus:false,
ignoreCooldown:false
}
);

return res.json({
success:true,
...result,
name
});

}catch(error){

console.log(
"FAVORITE ONLINE ERROR",
error
);

return res.status(500).json({
message:error.message
});

}

};

export const broadcastNotification =
async(req,res)=>{

try{

const {
title,
message,
type
}=req.body;

if(
!title?.trim() ||
!message?.trim()
){
return res.status(400).json({
message:"title and message required"
});
}

const result =
await notifyFemalesOnBroadcast({
id:Date.now(),
title:title.trim(),
message:message.trim(),
type:type ?? "broadcast"
});

return res.json({
success:true,
...result
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const getNotifications =
async(req,res)=>{

try{

const {
userId
}=req.params;

const notifications =
await NotificationRecord.findAll({
where:{
userId:Number(userId)
},
order:[
["createdAt","DESC"]
],
limit:100
});

return res.json({
notifications
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const markNotificationsRead =
async(req,res)=>{

try{

const {
userId
}=req.params;

await NotificationRecord.update(
{
read:true
},
{
where:{
userId:Number(userId),
read:false
}
}
);

return res.json({
success:true
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};
