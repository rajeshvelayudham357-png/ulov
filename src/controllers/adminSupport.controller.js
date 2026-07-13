import {
getSupportTicketForAdmin,
getSupportTicketMessages,
listAdminSupportTickets,
sendSupportAdminMessage,
updateSupportTicketStatus
} from "../services/support.service.js";

export const adminListTickets =
async(req,res)=>{
try{
const data =
await listAdminSupportTickets({
status:req.query.status,
search:req.query.search
});

res.json(data);
}catch(error){
res.status(500).json({
message:error.message
});
}
};

export const adminGetTicket =
async(req,res)=>{
try{
const ticketId =
Number(req.params.id);

const ticket =
await getSupportTicketForAdmin(ticketId);

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
userId:ticket.userId,
subject:ticket.subject,
message:ticket.message,
status:ticket.status,
createdAt:ticket.createdAt,
updatedAt:ticket.updatedAt,
user:ticket.user
? {
id:ticket.user.id,
name:ticket.user.name || ticket.user.username,
username:ticket.user.username,
phone:ticket.user.phone,
gender:ticket.user.gender,
avatar:ticket.user.avatar
}
: null
},
messages
});
}catch(error){
res.status(500).json({
message:error.message
});
}
};

export const adminSendMessage =
async(req,res)=>{
try{
const ticketId =
Number(req.params.id);

const {
message
} = req.body;

const result =
await sendSupportAdminMessage({
ticketId,
message,
adminId:req.admin?.id || null
});

if(result.error){
return res.status(400).json({
message:result.error
});
}

res.json({
success:true,
message:result.message,
ticket:result.ticket
});
}catch(error){
res.status(500).json({
message:error.message
});
}
};

export const adminUpdateStatus =
async(req,res)=>{
try{
const ticketId =
Number(req.params.id);

const {
status
} = req.body;

const result =
await updateSupportTicketStatus({
ticketId,
status
});

if(result.error){
return res.status(400).json({
message:result.error
});
}

res.json({
success:true,
ticket:result.ticket
});
}catch(error){
res.status(500).json({
message:error.message
});
}
};
