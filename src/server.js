import http from "http";

import { Server } from "socket.io";

import app from "./app.js";
import {
CallHistory,
User
} from "./models/index.js";
import {
initNotificationPush,
notifyIncomingCall
} from "./services/notificationPush.service.js";
import {
routeIncomingCallToCreator,
logCallDeliveryEvent,
} from "./services/callDelivery.service.js";
import {
initChatRealtime
} from "./services/chatRealtime.service.js";
import {
initSupportRealtime
} from "./services/supportRealtime.service.js";
import {
runDatabaseMigrations
} from "./services/databaseMigration.service.js";
import {
purgeOldChatMessages
} from "./controllers/chat.controller.js";
import {
findActiveCallByPair,
findActiveCallForReceiver,
isReceiverBusyWithOther,
cleanupStaleActiveCalls,
closeActiveCallsForUser,
completeCallRecord
} from "./services/callState.service.js";
import {
recordFemaleOnlineSessionEnd
} from "./services/femaleOnlineTime.service.js";
import { setSocketInstance as setAppSettingsSocketInstance } from "./services/appSettings.service.js";
import { setSocketInstance as setGoogleBillingSocketInstance } from "./services/googleBilling.service.js";
import { setFemaleOfflineSocketInstance } from "./services/femaleOffline.service.js";




// =====================
// CREATE SERVER
// =====================


const server =
http.createServer(app);




// =====================
// SOCKET INIT
// =====================


export const io =
new Server(
server,
{
 cors:{

  origin:"*",

  methods:[
   "GET",
   "POST"
  ]

 }
}
);




// =====================
// ONLINE USERS
// userId -> socketId
// =====================


const onlineUsers =
new Map();

const logCreatorCallDeliveryEvent =
async(data,event)=>{
try{

const callId =
data?.callId ?
String(data.callId)
:
null;

const creatorId =
data?.receiverId ?
Number(data.receiverId)
:
null;

if(
!callId ||
!creatorId
){
return;
}

await logCallDeliveryEvent({
callId,
callerId:
data?.callerId ??
null,
creatorId,
event,
metadata:{
source:"socket"
}
});

}catch(error){

console.log(
"CALL DELIVERY LOG ERROR",
error?.message ||
error
);

}
};

initNotificationPush(
io,
onlineUsers
);

setFemaleOfflineSocketInstance(
io,
onlineUsers
);

initChatRealtime(
io,
onlineUsers
);

initSupportRealtime(
io,
onlineUsers
);

setAppSettingsSocketInstance(io);
setGoogleBillingSocketInstance(io);

const startChatRetention =
async()=>{

try{
await purgeOldChatMessages();
}catch(error){
console.log(
"CHAT PURGE ERROR",
error.message
);
}

setInterval(
()=>{
purgeOldChatMessages().catch(
error=>{
console.log(
"CHAT PURGE ERROR",
error.message
);
}
);
},
6 *
60 *
60 *
1000
);
};

const startServer =
async()=>{

try{

console.log("Running database migrations...");
await runDatabaseMigrations();
console.log("Database migrations completed");

console.log("Starting HTTP server...");

server.listen(
3001,
"0.0.0.0",
()=>{
console.log(
"Server running on http://0.0.0.0:3001"
);
}
);

startChatRetention();

}catch(error){

console.error(
"SERVER START FAILED",
error
);

process.exit(1);

}

};

startServer();

const upsertLiveCall =
async (
data,
status = "live"
)=>{

if(
!data?.callerId ||
!data?.receiverId
){

return null;

}

const activeCall =
await findActiveCallByPair(
data.callerId,
data.receiverId
);

if(
activeCall
){

await activeCall.update({
type:data.type || activeCall.type || "video",
status
});

return activeCall;

}

return CallHistory.create({
callerId:data.callerId,
receiverId:data.receiverId,
type:data.type || "video",
duration:0,
coinsSpent:0,
status
});

};

const updateActiveCallStatus =
async (
data,
status
)=>{

if(
!data?.callerId ||
!data?.receiverId
){

return;

}

const activeCall =
await findActiveCallByPair(
data.callerId,
data.receiverId
);

if(
activeCall
){

await activeCall.update({
status
});

}

};






io.on(
"connection",
(socket)=>{



console.log(
"SOCKET CONNECTED",
socket.id
);







// =====================
// USER ONLINE REGISTER
// =====================


socket.on(
"register-user",
(data)=>{


const userId =
String(
data.userId
);



onlineUsers.set(
userId,
socket.id
);



console.log(
"USER ONLINE:",
userId
);



console.log(
"ONLINE USERS:",
onlineUsers
);



});









// =====================
// STATUS CHANGE RELAY
// =====================


socket.on(
"user-status-changed",
(data)=>{

socket.broadcast.emit(
"user-status-changed",
data
);

});




// =====================
// CALL GIFT RELAY
// =====================


socket.on(
"call-gift-sent",
(data)=>{

const receiverId =
String(
data?.receiverId || ""
);

if(!receiverId){
return;
}

const receiverSocketId =
onlineUsers.get(
receiverId
);

if(receiverSocketId){
io.to(
receiverSocketId
).emit(
"call-gift-received",
data
);
}

});




// =====================
// CALL USER
// MALE -> FEMALE
// =====================


socket.on(
"call-user",
async(data)=>{



console.log(
"CALL REQUEST:",
data
);

try{

const callerId =
data?.callerId;

const receiverId =
data?.receiverId;

if(
!callerId ||
!receiverId
){
return;
}

const receiverUser =
await User.findByPk(
receiverId,
{
attributes:["id","online","gender"]
}
);

if(
!receiverUser ||
!Boolean(receiverUser.online)
){
const callerSocket =
onlineUsers.get(
String(callerId)
);

if(callerSocket){
 io.to(callerSocket).emit(
 "user-offline",
 {
  receiverId,
  callerId
 }
 );
}

return;
}

const receiverBusy =
await isReceiverBusyWithOther(
receiverId,
callerId
);

if(receiverBusy){

const callerSocket =
onlineUsers.get(
String(callerId)
);

if(callerSocket){
 io.to(callerSocket).emit(
 "user-busy",
 {
  receiverId,
  callerId
 }
 );
}

return;

}

await upsertLiveCall(
data,
"live"
);

const receiverSocket =
onlineUsers.get(
String(
data.receiverId
)
);

console.log(
"RECEIVER SOCKET:",
receiverSocket
);

await routeIncomingCallToCreator({
io,
onlineUsers,
data:{
...data,
callId:
data.callId ?
String(data.callId)
:
undefined
},
creatorOnlineInDb:
Boolean(receiverUser?.online)
});

}catch(error){

console.log(
"LIVE CALL CREATE ERROR",
error.message
);

}


});









// =====================
// ACCEPT CALL
// FEMALE -> MALE
// =====================


socket.on(
"accept-call",
async(data)=>{



console.log(
"CALL ACCEPTED",
data
);

await logCreatorCallDeliveryEvent(
data,
"ACCEPTED"
);

try{

const callerId =
data?.callerId;

const receiverId =
data?.receiverId;

if(
callerId &&
receiverId
){

const otherCall =
await findActiveCallForReceiver(
receiverId,
callerId
);

if(otherCall){
 return;
}

}

await upsertLiveCall(
data,
"accepted"
);

}catch(error){

console.log(
"LIVE CALL ACCEPT ERROR",
error.message
);

}




const callerSocket =
onlineUsers.get(
String(
data.callerId
)
);




if(
callerSocket
){



io.to(
callerSocket
)
.emit(
"call-accepted",
data
);



}

const receiverSocket =
onlineUsers.get(
String(
data?.receiverId
)
);

if(
receiverSocket
){
io.to(
receiverSocket
)
.emit(
"call-accepted",
data
);
}



});










// =====================
// REJECT CALL
// =====================


socket.on(
"reject-call",
async(data)=>{



console.log(
"CALL REJECTED",
data
);

await logCreatorCallDeliveryEvent(
data,
"REJECTED"
);

try{

await updateActiveCallStatus(
data,
"rejected"
);

}catch(error){

console.log(
"LIVE CALL REJECT ERROR",
error.message
);

}



const callerSocket =
onlineUsers.get(
String(
data.callerId
)
);



if(
callerSocket
){


io.to(
callerSocket
)
.emit(
"call-rejected"
);


}



});










// =====================
// CANCEL CALL
// =====================


socket.on(
"cancel-call",
async(data)=>{

console.log(
"CALL CANCELLED",
data
);

try{

await updateActiveCallStatus(
data,
"cancelled"
);

}catch(error){

console.log(
"LIVE CALL CANCEL ERROR",
error.message
);

}

const receiverSocket =
onlineUsers.get(
String(
data?.receiverId
)
);

if(receiverSocket){

io.to(
receiverSocket
).emit(
"call-cancelled",
data
);

}

});




// =====================
// CALL FACE STATUS
// FEMALE -> MALE (video billing gate)
// =====================


socket.on(
"call-face-status",
(data)=>{

const toUserId =
data?.toUserId;

if(!toUserId){
return;
}

const targetSocket =
onlineUsers.get(
String(toUserId)
);

if(!targetSocket){
return;
}

io.to(
targetSocket
).emit(
"call-face-status",
{
 fromUserId:data?.fromUserId,
 toUserId,
 callSessionId:data?.callSessionId,
 faceDetected:Boolean(
 data?.faceDetected
 )
}
);

});




// =====================
// CALL FACE RESTRICT
// MALE -> FEMALE (toggle face countdown)
// =====================


socket.on(
"call-face-restrict",
(data)=>{

const toUserId =
data?.toUserId;

if(!toUserId){
return;
}

const targetSocket =
onlineUsers.get(
String(toUserId)
);

if(!targetSocket){
return;
}

io.to(
targetSocket
).emit(
"call-face-restrict",
{
 fromUserId:data?.fromUserId,
 toUserId,
 callSessionId:data?.callSessionId,
 restrictEnabled:Boolean(
 data?.restrictEnabled
 )
}
);

});




// =====================
// MISSED CALL
// =====================


socket.on(
"missed-call",
async(data)=>{



console.log(
"MISSED CALL",
data
);

await logCreatorCallDeliveryEvent(
data,
"MISSED"
);

try{

await updateActiveCallStatus(
data,
"missed"
);

}catch(error){

console.log(
"LIVE CALL MISSED ERROR",
error.message
);

}




const callerSocket =
onlineUsers.get(
String(
data.callerId
)
);




if(
callerSocket
){



io.to(
callerSocket
)
.emit(
"call-missed"
);



}



});










// =====================
// END CALL (CLIENT)
// =====================


socket.on(
"end-call",
async(data)=>{

try{

const callerId =
data?.callerId;

const receiverId =
data?.receiverId;

if(
!callerId ||
!receiverId
){
return;
}

const duration =
Math.max(
0,
Number(data?.duration ?? 0)
);

if(
duration > 0
){
await completeCallRecord({
callerId,
receiverId,
type:data?.type,
duration,
callHistoryId:data?.callHistoryId ?? data?.callId
});
return;
}

await updateActiveCallStatus(
data,
"completed"
);

const activeCall =
await findActiveCallByPair(
callerId,
receiverId
);

if(
activeCall &&
Number(activeCall.duration) <= 0
){
await activeCall.update({
duration:0,
coinsSpent:0
});
}

}catch(error){

console.log(
"END CALL SOCKET ERROR",
error.message
);

}

});


// =====================
// SUPPORT TICKET ROOMS
// =====================

socket.on(
"join-support-ticket",
(data)=>{
const ticketId =
Number(data?.ticketId);

if(!ticketId){
return;
}

socket.join(
`support-ticket-${ticketId}`
);
}
);

socket.on(
"join-support-admin",
()=>{
socket.join("support-admin");
}
);

socket.on(
"leave-support-ticket",
(data)=>{
const ticketId =
Number(data?.ticketId);

if(!ticketId){
return;
}

socket.leave(
`support-ticket-${ticketId}`
);
}
);

// =====================
// DISCONNECT
// =====================


socket.on(
"disconnect",
async()=>{



let removedUser=null;




for(
const [
userId,
socketId
]
of onlineUsers.entries()
){



if(
socketId === socket.id
){



removedUser =
userId;



onlineUsers.delete(
userId
);



break;



}



}





console.log(
"SOCKET DISCONNECTED",
socket.id
);



if(
removedUser
){


console.log(
"USER OFFLINE:",
removedUser
);

try{
const user =
await User.findByPk(
removedUser
);

if(
user &&
Boolean(user.online)
){
const isFemaleCreator =
String(user.gender || "")
.toLowerCase() === "female";

if(isFemaleCreator){
// Female creators stay available until they manually turn offline.
// App kill / socket drop only removes live socket; push delivers calls.
await recordFemaleOnlineSessionEnd(
removedUser
);

await closeActiveCallsForUser(
removedUser,
"completed"
);

console.log(
"FEMALE SOCKET DISCONNECTED - STAYING ONLINE:",
removedUser
);
}else{
await user.update({
online:false
});

await closeActiveCallsForUser(
removedUser,
"completed"
);

io.emit(
"user-status-changed",
{
userId:String(removedUser),
status:"offline",
online:false
}
);

console.log(
"USER MARKED OFFLINE IN DB:",
removedUser
);
}
}
}catch(error){
console.log(
"DISCONNECT OFFLINE UPDATE ERROR",
error.message
);
}


}




console.log(
"ONLINE USERS:",
onlineUsers
);



});






});







