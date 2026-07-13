import {
    Earning
   }
   from "../models/index.js";
   
   import {
    fn,
    col
   }
   from "sequelize";

import {
   getCreatorCallRateSummary
   } from "../services/callRate.service.js";
   import {
   getFemaleWithdrawSummary
   } from "../services/withdraw.service.js";
   
   
   
   export const getEarnings =
   async(req,res)=>{
   
   
   try{
   
   
   const {
   userId
   }
   =
   req.params;
   
   
   
   const earnings =
   await Earning.findAll({
   
   where:{
    userId
   },
   
   order:[
   ["createdAt","DESC"]
   ]
   
   });
   
   
   
   const totalGold =
   earnings.reduce(
   (total,item)=>{
   
   return (
   total +
   Number(item.coins || 0)
   );
   
   },
   0
   );
   
   
   
   
   const totalAmount =
   earnings.reduce(
   (total,item)=>{
   
   return (
   total +
   Number(item.amount || 0)
   );
   
   },
   0
   );

   const callRates =
   await getCreatorCallRateSummary(userId);

   const withdrawSummary =
   await getFemaleWithdrawSummary(userId);
   
   
   
   
   return res.json({
   
   
   totalGold,
   
   
   totalAmount,

   withdrawSummary,
   
   
   earnings,

   callRates
   
   
   });
   
   
   
   }catch(error){
   
   
   return res.status(500)
   .json({
   
   message:
   error.message
   
   });
   
   
   }
   
   
   };