import {
Op
} from "sequelize";

import {
SupportTicket,
SupportMessage,
User
} from "../models/index.js";

import {
emitSupportTicketMessage
} from "./supportRealtime.service.js";

const formatTicket =
(ticket,lastMessage=null)=>{
const plain =
ticket.get
? ticket.get({plain:true})
: ticket;

return {
id:plain.id,
userId:plain.userId,
subject:plain.subject,
message:plain.message,
status:plain.status,
reply:plain.reply,
createdAt:plain.createdAt,
updatedAt:plain.updatedAt,
user:plain.user
? {
id:plain.user.id,
name:plain.user.name || plain.user.username,
username:plain.user.username,
phone:plain.user.phone,
gender:plain.user.gender,
avatar:plain.user.avatar
}
: undefined,
lastMessage: lastMessage
? {
message:lastMessage.message,
senderType:lastMessage.senderType,
createdAt:lastMessage.createdAt
}
: {
message:plain.message,
senderType:"user",
createdAt:plain.createdAt
}
};
};

const getLastMessageForTicket =
async(ticketId)=>{
const last =
await SupportMessage.findOne({
where:{ticketId},
order:[["id","DESC"]]
});

return last;
};

export const ensureSupportTables =
async()=>{
await SupportMessage.sync({alter:true});
};

export const createSupportTicket =
async({
userId,
subject,
message
})=>{
const ticket =
await SupportTicket.create({
userId,
subject:subject.trim(),
message:message.trim(),
status:"open"
});

await SupportMessage.create({
ticketId:ticket.id,
senderType:"user",
senderId:userId,
message:message.trim()
});

const lastMessage =
await getLastMessageForTicket(ticket.id);

return formatTicket(
ticket,
lastMessage
);
};

export const listUserSupportTickets =
async(userId)=>{
const tickets =
await SupportTicket.findAll({
where:{userId},
order:[["updatedAt","DESC"]]
});

const results =
await Promise.all(
tickets.map(async(ticket)=>{
const lastMessage =
await getLastMessageForTicket(ticket.id);

return formatTicket(
ticket,
lastMessage
);
})
);

return results;
};

export const listAdminSupportTickets =
async({
status,
search
}={})=>{
const where={};

if(
status &&
status !== "all"
){
where.status = status;
}

if(search?.trim()){
const term = `%${search.trim()}%`;
where[Op.or]=[
{subject:{[Op.like]:term}},
{message:{[Op.like]:term}}
];
}

const tickets =
await SupportTicket.findAll({
where,
include:[
{
model:User,
as:"user",
attributes:[
"id",
"name",
"username",
"phone",
"gender",
"avatar"
]
}
],
order:[["updatedAt","DESC"]]
});

const results =
await Promise.all(
tickets.map(async(ticket)=>{
const lastMessage =
await getLastMessageForTicket(ticket.id);

return formatTicket(
ticket,
lastMessage
);
})
);

return results;
};

export const getSupportTicketForUser =
async({
ticketId,
userId
})=>{
const ticket =
await SupportTicket.findOne({
where:{
id:ticketId,
userId
}
});

return ticket;
};

export const getSupportTicketForAdmin =
async(ticketId)=>{
const ticket =
await SupportTicket.findOne({
where:{id:ticketId},
include:[
{
model:User,
as:"user",
attributes:[
"id",
"name",
"username",
"phone",
"gender",
"avatar"
]
}
]
});

return ticket;
};

const ensureLegacyTicketMessages =
async(ticket)=>{
const messageCount =
await SupportMessage.count({
where:{ticketId:ticket.id}
});

if(messageCount === 0 && ticket.message?.trim()){
await SupportMessage.create({
ticketId:ticket.id,
senderType:"user",
senderId:ticket.userId,
message:ticket.message.trim()
});
}

if(!ticket.reply?.trim()){
return;
}

const existingAdminMessage =
await SupportMessage.findOne({
where:{
ticketId:ticket.id,
senderType:"admin"
}
});

if(existingAdminMessage){
return;
}

await SupportMessage.create({
ticketId:ticket.id,
senderType:"admin",
senderId:null,
message:ticket.reply.trim()
});
};

export const getSupportTicketMessages =
async(ticketId)=>{
const ticket =
await SupportTicket.findByPk(ticketId);

if(!ticket){
return null;
}

await ensureLegacyTicketMessages(ticket);

const messages =
await SupportMessage.findAll({
where:{ticketId},
order:[["createdAt","ASC"]]
});

return messages.map((item)=>({
id:item.id,
ticketId:item.ticketId,
senderType:item.senderType,
senderId:item.senderId,
message:item.message,
createdAt:item.createdAt
}));
};

export const sendSupportUserMessage =
async({
ticketId,
userId,
message
})=>{
const ticket =
await getSupportTicketForUser({
ticketId,
userId
});

if(!ticket){
return {error:"Ticket not found"};
}

if(ticket.status === "closed"){
return {error:"This ticket is closed"};
}

const trimmed =
message?.trim();

if(!trimmed){
return {error:"Message is required"};
}

const created =
await SupportMessage.create({
ticketId,
senderType:"user",
senderId:userId,
message:trimmed
});

await ticket.update({
updatedAt:new Date()
});

const payload={
id:created.id,
ticketId:created.ticketId,
senderType:created.senderType,
senderId:created.senderId,
message:created.message,
createdAt:created.createdAt
};

emitSupportTicketMessage({
ticketId,
userId:ticket.userId,
payload
});

return {message:payload};
};

export const sendSupportAdminMessage =
async({
ticketId,
message,
adminId=null
})=>{
const ticket =
await SupportTicket.findByPk(ticketId);

if(!ticket){
return {error:"Ticket not found"};
}

if(ticket.status === "closed"){
return {error:"This ticket is closed"};
}

const trimmed =
message?.trim();

if(!trimmed){
return {error:"Message is required"};
}

const created =
await SupportMessage.create({
ticketId,
senderType:"admin",
senderId:adminId,
message:trimmed
});

await ticket.update({
status:"answered",
reply:trimmed,
updatedAt:new Date()
});

const payload={
id:created.id,
ticketId:created.ticketId,
senderType:created.senderType,
senderId:created.senderId,
message:created.message,
createdAt:created.createdAt
};

emitSupportTicketMessage({
ticketId,
userId:ticket.userId,
payload:{
...payload,
status:"answered"
}
});

return {
message:payload,
ticket:formatTicket(
await ticket.reload({
include:[
{
model:User,
as:"user",
attributes:[
"id",
"name",
"username",
"phone",
"gender",
"avatar"
]
}
]
}),
created
)
};
};

export const updateSupportTicketStatus =
async({
ticketId,
status
})=>{
const allowed =
["open","answered","closed"];

if(!allowed.includes(status)){
return {error:"Invalid status"};
}

const ticket =
await SupportTicket.findByPk(ticketId);

if(!ticket){
return {error:"Ticket not found"};
}

await ticket.update({status});

emitSupportTicketMessage({
ticketId,
userId:ticket.userId,
payload:{
type:"status",
status
}
});

return {
ticket:formatTicket(ticket)
};
};
