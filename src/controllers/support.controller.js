import {
    SupportTicket
    } from "../models/index.js";
    
    
    
    // CREATE TICKET
    
    export const createTicket =
    async(req,res)=>{
    
    
    try{
    
    
    const ticket =
    await SupportTicket.create(
    req.body
    );
    
    
    res.json(ticket);
    
    
    
    }catch(error){
    
    
    res.status(500)
    .json({
    message:error.message
    });
    
    
    }
    
    };
    
    
    
    
    // USER TICKETS
    
    export const myTickets =
    async(req,res)=>{
    
    
    try{
    
    
    const data =
    await SupportTicket.findAll({
    
    where:{
    
    userId:req.params.userId
    
    },
    
    
    order:[
    ["id","DESC"]
    ]
    
    
    });
    
    
    
    res.json(data);
    
    
    
    }catch(error){
    
    
    res.status(500)
    .json({
    message:error.message
    });
    
    
    }
    
    
    };
    
    
    
    
    // ADMIN REPLY
    
    export const replyTicket =
    async(req,res)=>{
    
    
    try{
    
    
    await SupportTicket.update(
    {
    
    reply:req.body.reply,
    
    status:"answered"
    
    },
    
    {
    
    where:{
    id:req.params.id
    }
    
    }
    
    );
    
    
    
    res.json({
    success:true
    });
    
    
    
    }catch(error){
    
    
    res.status(500)
    .json({
    message:error.message
    });
    
    }
    
    
    };