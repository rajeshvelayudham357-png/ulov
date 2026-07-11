import {
    Earning
   }
   from "../models/index.js";
   
   import {
    fn,
    col
   }
   from "sequelize";
   
   
   
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
   
   
   
   
   
   return res.json({
   
   
   totalGold,
   
   
   totalAmount,
   
   
   earnings
   
   
   });
   
   
   
   }catch(error){
   
   
   return res.status(500)
   .json({
   
   message:
   error.message
   
   });
   
   
   }
   
   
   };