import {
    Withdraw
    }
    from "../models/index.js";
    
    
    
    
    // CREATE REQUEST
    
    
    export const requestWithdraw =
    async(req,res)=>{
    
    
    try{
    
    
    const {
    
    userId,
    amount,
    upiId,
    accountName,
    accountNumber,
    ifsc
    
    }=req.body;
    
    
    
    
    if(amount < 100){
    
    return res.status(400)
    .json({
    
    message:
    "Minimum withdraw ₹100"
    
    });
    
    }
    
    
    
    
    const withdraw =
    await Withdraw.create({
    
    
    userId,
    
    amount,
    
    upiId,
    
    accountName,
    
    accountNumber,
    
    ifsc
    
    
    });
    
    
    
    
    return res.json({
    
    message:
    "Withdraw requested",
    
    withdraw
    
    });
    
    
    
    
    }catch(error){
    
    
    return res.status(500)
    .json({
    
    message:error.message
    
    });
    
    
    }
    
    
    };
    
    
    
    
    
    
    
    // HISTORY
    
    
    export const withdrawHistory =
    async(req,res)=>{
    
    
    try{
    
    
    const data =
    await Withdraw.findAll({
    
    where:{
    
    userId:req.params.userId
    
    },
    
    
    order:[
    ["createdAt","DESC"]
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