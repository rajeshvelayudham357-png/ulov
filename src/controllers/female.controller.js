import {
    Earning,
    CallHistory
    }
    from "../models/index.js";
    
    
    
    
    export const getFemaleDashboard =
    async(req,res)=>{
    
    
    try{
    
    
    const {
    userId
    }
    =
    req.params;
    
    
    
    
    const earnings =
    await Earning.sum(
    "amount",
    {
    where:{
    userId
    }
    }
    );
    
    
    
    const minutes =
    await Earning.sum(
    "duration",
    {
    where:{
    userId
    }
    }
    );
    
    
    
    
    const calls =
    await CallHistory.count(
    {
    where:{
    receiverId:userId
    }
    }
    );
    
    
    
    
    
    return res.json({
    
    earning:
    earnings || 0,
    
    
    minutes:
    minutes || 0,
    
    
    calls
    
    });
    
    
    
    
    
    }catch(error){
    
    
    return res.status(500)
    .json({
    message:error.message
    });
    
    
    }
    
    
    
    };