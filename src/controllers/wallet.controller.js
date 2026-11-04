import {
    CallHistory,
    Wallet,
    WalletTransaction
   }
   from "../models/index.js";
import {
  ACTIVE_CALL_STATUSES,
  completeCallRecord,
} from "../services/callState.service.js";
import {
  CALL_CHARGE_DESCRIPTION,
  CALL_CHARGE_REFERENCE_TYPE,
  getCallRatePerMinute,
  getCollectedCallCoins,
  getMaxIntervalCharge,
} from "../services/callSettlement.service.js";
import { computeMaleCallCost } from "../utils/callRate.util.js";
import { listUserRechargeHistory } from "../services/payment.service.js";
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
   
   
   
   
// Disabled: coins may only be credited by verified payments
// (payment.service / googleBilling.service) or admin credit tools.
export const rechargeWallet = async (_req, res) =>
  res.status(410).json({
    code: "ENDPOINT_DISABLED",
    message:
      "Coins can only be added through a verified payment or by an administrator.",
  });

// A charge that arrives just after the other side ended the call is still
// accepted so the last paid interval is not lost.
const LATE_CALL_CHARGE_WINDOW_MS = 2 * 60 * 1000;

const isChargeableCall = (call) => {
  if (ACTIVE_CALL_STATUSES.includes(call.status)) {
    return true;
  }

  if (call.status !== "completed") {
    return false;
  }

  const endedTime = new Date(call.endedAt ?? call.updatedAt).getTime();
  return (
    Number.isFinite(endedTime) &&
    Date.now() - endedTime <= LATE_CALL_CHARGE_WINDOW_MS
  );
};

// The app pays each interval at its start; this covers that plus clock skew.
const CALL_CHARGE_AHEAD_SECONDS = 30;

class CallChargeCapError extends Error {}

/**
 * Most coins a call may have collected by now: the cost of the server's own
 * accepted-to-now (or accepted-to-ended) span. Stops catch-up charges from
 * billing time after the call ended or beyond real elapsed time. Calls without
 * a server accept time are not capped.
 */
const getCallChargeCap = async (call) => {
  if (!call.acceptedAt) {
    return null;
  }

  const endTime = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
  const elapsedSeconds = Math.max(
    0,
    Math.floor((endTime - new Date(call.acceptedAt).getTime()) / 1000)
  );

  return computeMaleCallCost({
    durationSeconds: elapsedSeconds + CALL_CHARGE_AHEAD_SECONDS,
    type: call.type,
    ratePerMinute: await getCallRatePerMinute({
      type: call.type,
      receiverId: call.receiverId,
    }),
  }).maleCost;
};

export const spendWallet = async (req, res) => {
  try {
    await ensureWalletTransactionSchema();

    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (
      req.body?.userId !== undefined &&
      Number(req.body.userId) !== userId
    ) {
      return res.status(403).json({
        message: "You can only spend coins from your own wallet",
      });
    }

    const spendAmount = Number(req.body?.amount);

    if (!Number.isInteger(spendAmount) || spendAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const callReferenceId = Number(
      req.body?.referenceId ?? req.body?.callSessionId ?? req.body?.callId
    );
    const hasCallReference =
      Number.isFinite(callReferenceId) && callReferenceId > 0;

    let call = null;

    if (hasCallReference) {
      call = await CallHistory.findByPk(callReferenceId);

      if (!call) {
        return res.status(404).json({ message: "Call not found" });
      }

      if (Number(call.callerId) !== userId) {
        return res.status(403).json({
          message: "This call does not belong to you",
        });
      }

      // The server charges this call itself; a phone charge would double-bill.
      if (call.billingMode === "server") {
        const wallet = await Wallet.findOne({ where: { userId } });
        return res.json({ wallet, serverBilled: true });
      }

      if (!isChargeableCall(call)) {
        return res.status(409).json({ message: "Call is not active" });
      }
    }

    const maxCharge = await getMaxIntervalCharge({
      receiverId: call ? call.receiverId : null,
    });

    if (spendAmount > maxCharge) {
      return res.status(400).json({
        message: "Amount exceeds a single call billing interval",
      });
    }

    const chargeCap = call ? await getCallChargeCap(call) : null;

    const debited = await sequelize.transaction(async (transaction) => {
      // The conditional update takes the wallet row lock, so concurrent
      // charges for the same user are applied one after another.
      const [updatedCount] = await Wallet.update(
        { balance: sequelize.literal(`balance - ${spendAmount}`) },
        {
          where: { userId, balance: { [Op.gte]: spendAmount } },
          transaction,
        }
      );

      if (!updatedCount) {
        return false;
      }

      if (call && chargeCap !== null) {
        const collected = await getCollectedCallCoins({
          callId: call.id,
          callerId: userId,
          transaction,
        });

        if (collected + spendAmount > chargeCap) {
          throw new CallChargeCapError();
        }
      }

      if (call) {
        const existing = await WalletTransaction.findOne({
          where: {
            userId,
            type: "debit",
            description: CALL_CHARGE_DESCRIPTION,
            referenceType: CALL_CHARGE_REFERENCE_TYPE,
            referenceId: call.id,
          },
          order: [["createdAt", "DESC"]],
          transaction,
        });

        if (existing) {
          await existing.update(
            { amount: Number(existing.amount || 0) + spendAmount },
            { transaction }
          );
        } else {
          await WalletTransaction.create(
            {
              userId,
              type: "debit",
              amount: spendAmount,
              description: CALL_CHARGE_DESCRIPTION,
              referenceId: call.id,
              referenceType: CALL_CHARGE_REFERENCE_TYPE,
            },
            { transaction }
          );
        }
      } else {
        await WalletTransaction.create(
          {
            userId,
            type: "debit",
            amount: spendAmount,
            description: CALL_CHARGE_DESCRIPTION,
          },
          { transaction }
        );
      }

      return true;
    });

    if (!debited) {
      return res.status(400).json({ message: "Low balance" });
    }

    // A charge that lands after settlement raises the creator's earning,
    // still capped at the call's recorded cost.
    if (call?.settledAt || call?.status === "completed") {
      try {
        await completeCallRecord({
          callerId: call.callerId,
          receiverId: call.receiverId,
          type: call.type,
          callHistoryId: call.id,
        });
      } catch (settleError) {
        console.log("LATE CALL CHARGE SETTLE ERROR", call.id, settleError.message);
      }
    }

    const wallet = await Wallet.findOne({ where: { userId } });

    return res.json({ wallet });
  } catch (error) {
    if (error instanceof CallChargeCapError) {
      return res.status(409).json({
        code: "CALL_ALREADY_PAID",
        message: "This call time is already paid for",
      });
    }

    return res.status(500).json({ message: error.message });
  }
};

const RECHARGE_PAGE_SIZE = 20;

export const getRechargeHistory =
async(req,res)=>{


try{

await ensureWalletTransactionSchema();

const userId =
Number(req.params.userId);

const limit =
Math.min(
50,
Math.max(
1,
Number(req.query.limit) || RECHARGE_PAGE_SIZE
)
);

const offset =
Math.max(
0,
Number(req.query.offset) || 0
);

if(!Number.isFinite(userId) || userId <= 0){
return res.status(400).json({
message:"Valid user id is required"
});
}

const outcome =
String(req.query.outcome || "").toLowerCase();

const history =
await listUserRechargeHistory({
userId,
limit,
offset,
outcome:
["added","cancelled","failed","incomplete"].includes(outcome)
? outcome
: null
});

return res.json({

recharges:history.recharges,
limit,
offset,
total:history.total,
hasMore:offset + history.recharges.length < history.total

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