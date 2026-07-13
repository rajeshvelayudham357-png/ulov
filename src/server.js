import http from "http";

import { Server } from "socket.io";

import app from "./app.js";
import {
CallHistory,
DeviceToken,
NotificationRecord,
ChatMessage,
CallRating,
Block,
Earning
} from "./models/index.js";
import {
Op
} from "sequelize";
import {
initNotificationPush,
notifyMalesWhenFemaleOnline
} from "./services/notificationPush.service.js";
import {
initChatRealtime
} from "./services/chatRealtime.service.js";
import {
initSupportRealtime
} from "./services/supportRealtime.service.js";
import {
ensureSupportTables
} from "./services/support.service.js";
import {
ensureUserSchema
} from "./services/userSchema.service.js";
import {
purgeOldChatMessages
} from "./controllers/chat.controller.js";
import {
findActiveCallByPair,
findActiveCallForReceiver,
isReceiverBusyWithOther
} from "./services/callState.service.js";




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

initNotificationPush(
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

const syncNotificationTables =
async()=>{

try{

await DeviceToken.sync({
alter:true
});

await NotificationRecord.sync({
alter:true
});

await ChatMessage.sync({
alter:true
});

await CallRating.sync({
alter:true
});

await Block.sync({
alter:true
});

await Earning.sync({
alter:true
});

console.log(
"Notification tables ready"
);

}catch(error){

console.log(
"NOTIFICATION TABLE SYNC ERROR",
error.message
);

}

try{

await ensureUserSchema();

await ensureSupportTables();

console.log(
"Support tables ready"
);

}catch(error){

console.log(
"SUPPORT TABLE SYNC ERROR",
error.message
);

}

};

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

syncNotificationTables();
startChatRetention();

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

const status =
data?.status ??
(
data?.online
?
"online"
:
"offline"
);

if(
status === "online" &&
data?.userId
){
notifyMalesWhenFemaleOnline(
data.userId,
{
broadcastStatus:false
}
).catch(
error=>{
console.log(
"SOCKET FAVORITE ONLINE ERROR",
error.message
);
}
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

}catch(error){

console.log(
"LIVE CALL CREATE ERROR",
error.message
);

}




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





if(
receiverSocket
){



io.to(
receiverSocket
)
.emit(
"incoming-call",
data
);



}
else{


console.log(
"USER OFFLINE",
data.receiverId
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
// MISSED CALL
// =====================


socket.on(
"missed-call",
async(data)=>{



console.log(
"MISSED CALL",
data
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
()=>{



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


}




console.log(
"ONLINE USERS:",
onlineUsers
);



});






});








// =====================
// START SERVER
// =====================


server.listen(
3001,
()=>{


console.log(
"Server running on port 3001"
);


}
);