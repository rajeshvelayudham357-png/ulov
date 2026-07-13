import {
    Wallet
  } from "../models/index.js";
import {
completeCallRecord
} from "../services/callState.service.js";
  
  
  
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
  
  
  
  
  const {
  history,
  earning,
  billing,
  alreadyCompleted
  }=
  await completeCallRecord({
  callerId,
  receiverId,
  type,
  duration
  });
  
  
  if(!alreadyCompleted){
  
  
  const wallet =
  await Wallet.findOne({
  
  where:{
  userId:callerId
  }
  
  });
  
  
  
  if(wallet){
  
  
  await wallet.update({
  
  balance:
  wallet.balance - billing.maleCost
  
  });
  
  
  }
  
  
  }
  
  
  
  
  
  
  
  
  return res.json({
  
  
  success:true,
  
  
  duration,
  
  
  maleCost:
  billing.maleCost,
  
  
  femaleEarn:
  billing.femaleEarn,
  
  
  creatorEarningPercentage:
  billing.femaleEarningPercentage,
  
  
  callHistoryId:
  history.id,
  
  
  earning,
  
  
  alreadyCompleted
  
  
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