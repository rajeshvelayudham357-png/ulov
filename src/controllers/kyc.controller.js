import {
    Kyc
    }
    from "../models/index.js";
    
    
    
    // SAVE BANK KYC
    
    
    export const saveKyc =
    async(req,res)=>{
    
    
    try{
    
    
    const {
    
    userId,
    accountName,
    bankName,
    accountNumber,
    ifsc,
    upiId
    
    }
    =
    req.body;
    
    
    
    
    let kyc =
    await Kyc.findOne({
    
    where:{
    userId
    }
    
    });
    
    
    
    
    if(kyc){
    
    
    await kyc.update({
    
    accountName,
    
    bankName,
    
    accountNumber,
    
    ifsc,
    
    upiId,
    
    status:"pending"
    
    });
    
    
    }
    
    else{
    
    
    kyc =
    await Kyc.create({
    
    userId,
    
    accountName,
    
    bankName,
    
    accountNumber,
    
    ifsc,
    
    upiId,
    
    status:"pending"
    
    });
    
    
    }
    
    
    
    
    
    return res.json({
    
    
    message:
    "Bank details submitted",
    
    
    kyc
    
    
    });
    
    
    
    
    }catch(error){
    
    
    
    return res.status(500)
    .json({
    
    message:error.message
    
    });
    
    
    
    }
    
    
    };
    
    
    
    
    
    
    
    
    // GET KYC
    
    
    export const getKyc =
    async(req,res)=>{
    
    
    try{
    
    
    const kyc =
    await Kyc.findOne({
    
    where:{
    
    userId:
    req.params.userId
    
    }
    
    });
    
    
    
    return res.json(
    kyc
    );
    
    
    
    }catch(error){
    
    
    return res.status(500)
    .json({
    
    message:error.message
    
    });
    
    
    }
    
    
    };