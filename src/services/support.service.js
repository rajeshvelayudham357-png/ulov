import {
Op,
QueryTypes,
} from "sequelize";

import {
SupportTicket,
SupportMessage,
User
} from "../models/index.js";
import { sequelize } from "../config/database.js";

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
try{
await SupportTicket.sync({alter:true});
}catch(error){
console.log(
"SupportTicket alter sync skipped:",
error.message
);
await SupportTicket.sync();
}

try{
await SupportMessage.sync({alter:true});
}catch(error){
console.log(
"SupportMessage alter sync skipped:",
error.message
);
await SupportMessage.sync();
}
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

const mapAdminSupportTicketRow = (row) => ({
  id: row.id,
  userId: row.userId,
  subject: row.subject,
  message: row.message,
  status: row.status,
  reply: row.reply,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  user: row.user_id
    ? {
        id: row.user_id,
        name: row.user_name || row.user_username,
        username: row.user_username,
        phone: row.user_phone,
        gender: row.user_gender,
        avatar: row.user_avatar,
      }
    : undefined,
  lastMessage: row.last_message
    ? {
        message: row.last_message,
        senderType: row.last_senderType,
        createdAt: row.last_createdAt,
      }
    : {
        message: row.message,
        senderType: "user",
        createdAt: row.createdAt,
      },
});

export const listAdminSupportTickets = async ({
  status,
  search,
  page = 1,
  limit = 50,
} = {}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  const whereParts = ["1=1"];
  const replacements = {
    limit: safeLimit,
    offset,
  };

  if (status && status !== "all") {
    whereParts.push("st.status = :status");
    replacements.status = status;
  }

  if (search?.trim()) {
    whereParts.push(`(
      st.subject LIKE :searchLike OR
      st.message LIKE :searchLike OR
      u.name LIKE :searchLike OR
      u.username LIKE :searchLike OR
      u.phone LIKE :searchLike
    )`);
    replacements.searchLike = `%${search.trim()}%`;
  }

  const whereSql = whereParts.join(" AND ");
  const fromSql = `
    FROM support_tickets st
    LEFT JOIN users u ON u.id = st.userId
    LEFT JOIN (
      SELECT sm.ticketId, sm.message, sm.senderType, sm.createdAt
      FROM support_messages sm
      INNER JOIN (
        SELECT ticketId, MAX(id) AS maxId
        FROM support_messages
        GROUP BY ticketId
      ) latest ON latest.maxId = sm.id
    ) lm ON lm.ticketId = st.id
  `;

  const [countRow, rows] = await Promise.all([
    sequelize.query(
      `SELECT COUNT(DISTINCT st.id) AS total
       ${fromSql}
       WHERE ${whereSql}`,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    ).then((result) => result[0]),
    sequelize.query(
      `SELECT st.id,
              st.userId,
              st.subject,
              st.message,
              st.status,
              st.reply,
              st.createdAt,
              st.updatedAt,
              u.id AS user_id,
              u.name AS user_name,
              u.username AS user_username,
              u.phone AS user_phone,
              u.gender AS user_gender,
              u.avatar AS user_avatar,
              lm.message AS last_message,
              lm.senderType AS last_senderType,
              lm.createdAt AS last_createdAt
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY st.updatedAt DESC
       LIMIT :limit OFFSET :offset`,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    ),
  ]);

  const total = Number(countRow?.total) || 0;

  return {
    rows: rows.map(mapAdminSupportTicketRow),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
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
