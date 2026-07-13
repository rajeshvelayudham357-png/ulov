let ioRef = null;
let onlineUsersRef = null;

export const initSupportRealtime =
(io,onlineUsers)=>{
ioRef = io;
onlineUsersRef = onlineUsers;
};

export const emitSupportTicketMessage =
({
ticketId,
userId,
payload
})=>{
if(!ioRef){
return;
}

ioRef
.to(`support-ticket-${ticketId}`)
.emit(
"support-ticket-message",
payload
);

ioRef
.to("support-admin")
.emit(
"support-ticket-update",
{
ticketId,
userId,
...payload
}
);

const socketId =
onlineUsersRef?.get(
String(userId)
);

if(socketId){
ioRef
.to(socketId)
.emit(
"support-ticket-update",
{
ticketId,
...payload
}
);
}
};
