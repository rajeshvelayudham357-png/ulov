import {
    User,
    Wallet,
    CallHistory,
    Earning
  } from "../models/index.js";
import {
Op
} from "sequelize";
  
  
  
  // ======================
  // END CALL
  // ======================
  
  
  export const endCall =
  async(req,res)=>{
  
  
  try{
  
  
  const {
  
  callerId,
  receiverId,
  duration,
  type
  
  }=req.body;
  
  
  
  
  // seconds to minutes
  
  const minutes =
  Math.max(
  1,
  Math.ceil(
  duration / 60
  )
  );
  
  
  
  
  // RATE CONFIG
  
  const maleCost =
  minutes * 60;
  
  
  const femaleEarn =
  minutes * 30;
  
  
  
  
  
  // ======================
  // DEDUCT MALE WALLET
  // ======================
  
  
  const wallet =
  await Wallet.findOne({
  
  where:{
  userId:callerId
  }
  
  });
  
  
  
  if(wallet){
  
  
  await wallet.update({
  
  balance:
  wallet.balance - maleCost
  
  });
  
  
  }
  
  
  
  
  
  
  // ======================
  // SAVE HISTORY
  // ======================
  
  
  const activeStatuses = [
  "live",
  "ongoing",
  "in_progress",
  "accepted"
  ];
  
  
  let history =
  await CallHistory.findOne({
  
  where:{
  callerId,
  receiverId,
  status:{
  [Op.in]:activeStatuses
  }
  },
  
  order:[
  [
  "createdAt",
  "DESC"
  ]
  ]
  
  });
  
  
  if(history){
  
  
  await history.update({
  
  type,
  
  duration,
  
  coinsSpent:
  maleCost,
  
  status:
  "completed"
  
  });
  
  
  }else{
  
  
  history =
  await CallHistory.create({
  
  
  callerId,
  
  
  receiverId,
  
  
  type,
  
  
  duration,
  
  
  coinsSpent:
  maleCost,
  
  
  status:
  "completed"
  
  
  });
  
  
  }
  
  
  
  
  
  
  
  // ======================
  // CREDIT FEMALE
  // ======================
  
  
  await Earning.create({
  
  
  userId:
  receiverId,
  
  
  callId:
  history.id,
  
  
  coins:
  femaleEarn,
  
  
  amount:
  femaleEarn / 2,
  
  
  duration:
  minutes,
  
  
  status:
  "pending"
  
  
  });
  
  
  
  
  
  
  
  
  return res.json({
  
  
  success:true,
  
  
  duration,
  
  
  maleCost,
  
  
  femaleEarn
  
  
  });
  
  
  
  
  
  
  }catch(error){
  
  
  
  console.log(
  "CALL END ERROR",
  error
  );
  
  
  
  return res.status(500).json({
  
  message:error.message
  
  });
  
  
  
  }
  
  
  };