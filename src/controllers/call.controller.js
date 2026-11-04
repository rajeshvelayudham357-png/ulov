import { generateAgoraToken, getAgoraAppId } from "../services/agora.service.js";
import { recordClientCallDeliveryEvent } from "../services/callDelivery.service.js";
import { assertCanAffordInitialCallCharge } from "../services/callSettlement.service.js";
import { getNewCallBillingFields } from "../services/callBillingEngine.service.js";
import {
areUsersBlocked
} from "../services/block.service.js";
import {
  recordCallAttemptedFromNewCallHistory,
} from "../services/engagementRecord.service.js";
import {
findActiveCallByPair,
getChannelNameForCall,
isReceiverBusyWithOther,
ACTIVE_CALL_STATUSES
} from "../services/callState.service.js";
import {
normalizeCallTypeForDb
} from "../constants/callTypes.js";
import {
CallHistory,
User
} from "../models/index.js";
import {
CALL_MODES,
normalizeCallMode,
} from "../constants/quickConnect.js";
import {
createQuickConnectSession,
cancelQuickConnectSession,
} from "../services/quickConnect.service.js";
import {
getPendingIncomingCallForReceiver,
isIncomingCallWithinDeliveryWindow,
} from "../services/callIncomingRecovery.service.js";

export const createVideoCall =
async(req,res)=>{


try{


const {
receiverId,
type,
mode: rawMode,
callerName,
callerAvatar,
}=req.body;

// The caller is always the logged-in user; a different id in the body is refused.
const callerId =
Number(req.user?.id);

if(!callerId){
return res.status(401).json({
message:"Unauthorized"
});
}

if(
req.body?.callerId !== undefined &&
Number(req.body.callerId) !== callerId
){
return res.status(403).json({
message:"You can only start calls as yourself"
});
}

const mode = normalizeCallMode(rawMode);

if (mode === CALL_MODES.QUICK_CONNECT) {
  if (receiverId) {
    return res.status(400).json({
      message: "Quick Connect does not accept receiverId",
    });
  }

  const quickConnectResult = await createQuickConnectSession({
    callerId,
    type,
    callerName: callerName ?? null,
    callerAvatar: callerAvatar ?? null,
    billingCapability: req.body?.billingCapability ?? null,
  });

  return res.json(quickConnectResult);
}

const normalizedType =
normalizeCallTypeForDb(type);



if(
!receiverId ||
!callerId
){


return res.status(400).json({

message:"callerId and receiverId required"

});


}



const blocked =
await areUsersBlocked(
callerId,
receiverId
);

if(blocked){

return res.status(403).json({

message:"Call is not available with this user"

});

}



const receiverBusy =
await isReceiverBusyWithOther(
receiverId,
callerId
);

if(receiverBusy){

return res.status(409).json({

success:false,
busy:true,
message:"User is busy on another call"

});

}

const receiver =
await User.findByPk(
receiverId,
{
attributes:[
"gender",
"online",
"acceptVoiceCalls",
"acceptVideoCalls"
]
}
);

if(
!receiver ||
!Boolean(receiver.online)
){
return res.status(409).json({
success:false,
offline:true,
message:"User is offline"
});
}

if(
receiver &&
String(receiver.gender ?? "")
.toLowerCase() === "female"
){
const acceptsVoice =
Boolean(receiver.acceptVoiceCalls ?? true);

const acceptsVideo =
Boolean(receiver.acceptVideoCalls ?? true);

if(
normalizedType === "voice" &&
!acceptsVoice
){
return res.status(403).json({
message:"This user is not accepting voice calls"
});
}

if(
normalizedType === "video" &&
!acceptsVideo
){
return res.status(403).json({
message:"This user is not accepting video calls"
});
}
}



await assertCanAffordInitialCallCharge({
callerId,
type:normalizedType,
receiverId
});

const callerUid =
Number(callerId);


const receiverUid =
Number(receiverId);



const billingFields =
await getNewCallBillingFields({
capability:req.body?.billingCapability,
type:normalizedType,
receiverId
});

let liveCall =
await findActiveCallByPair(
callerId,
receiverId
);

if(
liveCall
){

await liveCall.update({
type:normalizedType,
duration:0,
coinsSpent:0,
status:"live",
...billingFields
});

}else{

liveCall =
await CallHistory.create({
callerId,
receiverId,
type:normalizedType,
duration:0,
coinsSpent:0,
status:"live",
...billingFields
});

recordCallAttemptedFromNewCallHistory(liveCall);

}



const channelName =
getChannelNameForCall(
liveCall.id
);



const callerToken =
await generateAgoraToken(
channelName,
callerUid
);



const receiverToken =
await generateAgoraToken(
channelName,
receiverUid
);

const appId =
await getAgoraAppId();



return res.json({


success:true,


appId,


channelName,


callId:
liveCall.id,

// "server": the server charges this call and the app must not.
billingMode:
billingFields.billingMode,


caller:{
uid:callerUid,
token:callerToken
},


receiver:{
uid:receiverUid,
token:receiverToken
}


});




}catch(error){


res.status(error.statusCode || 500).json({
message:error.message,
...(error.code ? { code:error.code } : {}),
...(error.required !== undefined
? { required:error.required, balance:error.balance }
: {})
});


}


};

export const reportCallDeliveryEvent = async (req, res) => {
  try {
    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { callId, event, metadata } = req.body || {};

    const result = await recordClientCallDeliveryEvent({
      userId,
      callId,
      event,
      metadata: {
        ...(metadata || {}),
        callerId: metadata?.callerId ?? req.body?.callerId ?? null,
      },
    });

    return res.json(result);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

export const getPendingIncomingCall = async (req, res) => {
  try {
    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const payload = await getPendingIncomingCallForReceiver(userId);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getIncomingCallStatus = async (req, res) => {
  try {
    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const rawCallId = req.query.callId;
    const callerId = Number(req.query.callerId);
    const receiverId = Number(req.query.receiverId);

    let call = null;

    const numericCallId = Number(rawCallId);

    if (
      rawCallId &&
      Number.isFinite(numericCallId) &&
      numericCallId > 0
    ) {
      call = await CallHistory.findByPk(numericCallId);
    }

    if (
      !call &&
      Number.isFinite(callerId) &&
      Number.isFinite(receiverId)
    ) {
      call = await CallHistory.findOne({
        where: {
          callerId,
          receiverId,
        },
        order: [["createdAt", "DESC"]],
      });
    }

    if (!call) {
      return res.json({
        active: false,
        status: "not_found",
      });
    }

    const row = call.toJSON();

    if (
      Number(row.callerId) !== userId &&
      Number(row.receiverId) !== userId
    ) {
      return res.status(403).json({
        message: "Forbidden",
      });
    }

    const status = String(row.status || "");

    const withinWindow = isIncomingCallWithinDeliveryWindow(row);

    return res.json({
      active:
        withinWindow &&
        ACTIVE_CALL_STATUSES.includes(status),
      status: withinWindow ? status : "expired",
      callId: row.id,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const cancelQuickConnect = async (req, res) => {
  try {
    const userId = Number(req.user?.id ?? req.body?.callerId);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const sessionId = Number(req.body?.sessionId);

    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ message: "sessionId required" });
    }

    const result = await cancelQuickConnectSession({
      sessionId,
      callerId: userId,
    });

    if (!result.cancelled) {
      return res.status(result.reason === "forbidden" ? 403 : 404).json({
        success: false,
        message: result.reason || "Unable to cancel session",
      });
    }

    return res.json({
      success: true,
      sessionId,
      alreadyTerminal: Boolean(result.alreadyTerminal),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
