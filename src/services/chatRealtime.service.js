let ioRef = null;
let onlineUsersRef = null;

export const initChatRealtime =
(io,onlineUsers)=>{
ioRef = io;
onlineUsersRef = onlineUsers;
};

export const emitChatMessage =
(userId,payload)=>{
if(
!ioRef ||
!onlineUsersRef
){
return;
}

const socketId =
onlineUsersRef.get(
String(userId)
);

if(!socketId){
return;
}

ioRef
.to(socketId)
.emit(
"new-chat-message",
payload
);
};
