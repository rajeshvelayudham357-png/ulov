import {
    Wallet,
    WalletTransaction
   }
   from "../models/index.js";
import {
Op
} from "sequelize";
import {
sequelize
} from "../config/database.js";
   
   
   
   
   // GET WALLET
   
   export const getWallet =
   async(req,res)=>{
   
   
   try{
   
   
   const {
    userId
   }=req.params;
   
   
   
   let wallet =
   await Wallet.findOne({
   
   where:{
    userId
   }
   
   });
   
   
   
   if(!wallet){
   
   
   wallet =
   await Wallet.create({
   
   userId,
   
   balance:0
   
   });
   
   
   }
   
   
   
   res.json({
   
   wallet
   
   });
   
   
   
   
   }catch(error){
   
   
   res.status(500).json({
   
   message:error.message
   
   });
   
   
   }
   
   
   };
   
   
   
   
   // RECHARGE GOLD
   
   
   export const rechargeWallet =
   async(req,res)=>{
   
   
   try{
   
   
   const {
    userId,
    amount
   }=req.body;
   
   
   
   let wallet =
   await Wallet.findOne({
   
   where:{
    userId
   }
   
   });
   
   
   
   // create wallet if missing
   if(!wallet){
   
   
   wallet =
   await Wallet.create({
   
   userId,
   
   balance:0
   
   });
   
   
   }
   
   
   
   wallet.balance =
   Number(wallet.balance)
   +
   Number(amount);
   
   
   
   await wallet.save();
   
   
   
   
   await WalletTransaction.create({
   
   userId,
   
   type:"credit",
   
   amount,
   
   description:"Gold Recharge"
   
   });
   
   
   
   
   return res.json({
   
   wallet
   
   });
   
   
   
   
   }catch(error){
   
   
   return res.status(500).json({
   
   message:error.message
   
   });
   
   
   }
   
   
   };
   
   
   
   
   
   
   // SPEND GOLD
   
   
   export const spendWallet =
async(req,res)=>{


try{


const {
 userId,
 amount
}=req.body;



const wallet =
await Wallet.findOne({

where:{
 userId
}

});




if(!wallet){


return res.status(400).json({

message:"Wallet not found"

});


}




const spendAmount =
Number(amount);

if(
!Number.isFinite(spendAmount) ||
spendAmount <= 0
){

return res.status(400).json({

message:"Invalid amount"

});

}



const [
updatedCount
]=
await Wallet.update(
{
balance:sequelize.literal(
`balance - ${spendAmount}`
)
},
{
where:{
 userId,
 balance:{
  [Op.gte]:spendAmount
 }
}
});




if(!updatedCount){


return res.status(400).json({

message:"Low balance"

});


}




await wallet.reload();




await WalletTransaction.create({

userId,

type:"debit",

amount,

description:"Call charge"

});




return res.json({

wallet

});




}catch(error){


return res.status(500).json({

message:error.message

});


}


};

export const getWalletTransactions =
async(req,res)=>{


try{


const {
 userId
}=req.params;



const transactions =
await WalletTransaction.findAll({

where:{
 userId
},


order:[
 ["createdAt","DESC"]
]

});




return res.json({

transactions

});



}catch(error){


return res.status(500).json({

message:error.message

});


}


};