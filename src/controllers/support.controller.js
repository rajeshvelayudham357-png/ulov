import {
createSupportTicket,
getSupportTicketForUser,
getSupportTicketMessages,
listUserSupportTickets,
sendSupportUserMessage
} from "../services/support.service.js";

export const createTicket =
async(req,res)=>{
try{
const {
userId,
subject,
message
} = req.body;

if(
!userId ||
!subject?.trim() ||
!message?.trim()
){
return res.status(400).json({
message:"userId, subject and message are required"
});
}

const ticket =
await createSupportTicket({
userId,
subject,
message
});

res.json({
success:true,
ticket
});
}catch(error){
res.status(500).json({
message:error.message
});
}
};

export const myTickets =
async(req,res)=>{
try{
const data =
await listUserSupportTickets(
req.params.userId
);

res.json(data);
}catch(error){
res.status(500).json({
message:error.message
});
}
};

export const getTicketMessages =
async(req,res)=>{
try{
const ticketId =
Number(req.params.ticketId);

const userId =
Number(
req.query.userId ||
req.body?.userId
);

if(!userId){
return res.status(400).json({
message:"userId is required"
});
}

const ticket =
await getSupportTicketForUser({
ticketId,
userId
});

if(!ticket){
return res.status(404).json({
message:"Ticket not found"
});
}

const messages =
await getSupportTicketMessages(ticketId);

res.json({
ticket:{
id:ticket.id,
subject:ticket.subject,
status:ticket.status,
createdAt:ticket.createdAt
},
messages
});
}catch(error){
res.status(500).json({
message:error.message
});
}
};

export const sendTicketMessage =
async(req,res)=>{
try{
const ticketId =
Number(req.params.ticketId);

const {
userId,
message
} = req.body;

const result =
await sendSupportUserMessage({
ticketId,
userId,
message
});

if(result.error){
return res.status(400).json({
message:result.error
});
}

res.json({
success:true,
message:result.message
});
}catch(error){
res.status(500).json({
message:error.message
});
}
};
