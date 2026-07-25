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

let walletTxSchemaReady =
false;

const ensureWalletTransactionSchema =
async()=>{
if(walletTxSchemaReady){
return;
}

try{
 await sequelize.query(
 `ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS referenceId BIGINT NULL`
 );
}catch(error){
 // MySQL < 8 may not support IF NOT EXISTS on ADD COLUMN
 try{
  await sequelize.query(
  `ALTER TABLE wallet_transactions
   ADD COLUMN referenceId BIGINT NULL`
  );
 }catch(_error){
  // column may already exist
 }
}

try{
 await sequelize.query(
 `ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS referenceType VARCHAR(64) NULL`
 );
}catch(error){
 try{
  await sequelize.query(
  `ALTER TABLE wallet_transactions
   ADD COLUMN referenceType VARCHAR(64) NULL`
  );
 }catch(_error){
  // column may already exist
 }
}

walletTxSchemaReady =
true;
};

const isCallCharge =
(tx)=>
tx?.type === "debit" &&
String(tx?.description || "")
.toLowerCase()
.includes("call charge");

/**
 * Consolidate per-minute call debits into one row per call for history UI.
 * - New spends: same referenceId (call session)
 * - Legacy spends: group nearby Call charge rows (gap <= 90s)
 */
const consolidateCallChargeTransactions =
(transactions)=>{
const legacyGapMs =
75 * 1000;

const result = [];
const byReference = new Map();
let legacyGroup = null;

const flushLegacy = ()=>{
 if(!legacyGroup){
  return;
 }

 result.push(legacyGroup);
 legacyGroup = null;
};

for(
const tx of transactions
){
 if(!isCallCharge(tx)){
  flushLegacy();
  result.push(tx);
  continue;
 }

 const referenceId =
 Number(tx.referenceId);

 if(
 Number.isFinite(referenceId) &&
 referenceId > 0
 ){
  flushLegacy();

  const existing =
  byReference.get(referenceId);

  if(existing){
   existing.amount =
   Number(existing.amount || 0) +
   Number(tx.amount || 0);
   // Keep newest createdAt (list is DESC)
   continue;
  }

  const consolidated = {
   ...(tx.toJSON?.() ?? tx),
   amount:Number(tx.amount || 0),
   description:"Call charge",
   referenceId,
   referenceType:
   tx.referenceType || "call"
  };

  byReference.set(
  referenceId,
  consolidated
  );
  result.push(consolidated);
  continue;
 }

 // Legacy Call charge rows without referenceId
 const createdAt =
 new Date(tx.createdAt).getTime();

 if(
 legacyGroup &&
 Math.abs(
  new Date(legacyGroup.createdAt).getTime() -
  createdAt
 ) <= legacyGapMs
 ){
  legacyGroup.amount =
  Number(legacyGroup.amount || 0) +
  Number(tx.amount || 0);
  continue;
 }

 flushLegacy();
 legacyGroup = {
  ...(tx.toJSON?.() ?? tx),
  amount:Number(tx.amount || 0),
  description:"Call charge"
 };
}

flushLegacy();

return result;
};
   
   
   
   
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

await ensureWalletTransactionSchema();

const {
 userId,
 amount,
 callSessionId,
 callId,
 referenceId
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

const callReferenceId =
Number(
referenceId ??
callSessionId ??
callId
);

const hasCallReference =
Number.isFinite(callReferenceId) &&
callReferenceId > 0;



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

if(hasCallReference){
 const existing =
 await WalletTransaction.findOne({
  where:{
   userId,
   type:"debit",
   description:"Call charge",
   referenceType:"call",
   referenceId:callReferenceId
  },
  order:[
   ["createdAt","DESC"]
  ]
 });

 if(existing){
  await existing.update({
   amount:
   Number(existing.amount || 0) +
   spendAmount
  });
 }else{
  await WalletTransaction.create({
   userId,
   type:"debit",
   amount:spendAmount,
   description:"Call charge",
   referenceId:callReferenceId,
   referenceType:"call"
  });
 }
}else{
 await WalletTransaction.create({
  userId,
  type:"debit",
  amount:spendAmount,
  description:"Call charge"
 });
}




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

await ensureWalletTransactionSchema();

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

const consolidated =
consolidateCallChargeTransactions(
transactions
);




return res.json({

transactions:consolidated

});



}catch(error){


return res.status(500).json({

message:error.message

});


}


};