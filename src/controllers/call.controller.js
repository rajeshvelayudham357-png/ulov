import { generateAgoraToken, getAgoraAppId } from "../services/agora.service.js";
import { recordClientCallDeliveryEvent } from "../services/callDelivery.service.js";
import {
areUsersBlocked
} from "../services/block.service.js";
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

export const createVideoCall =
async(req,res)=>{


try{


const {
receiverId,
callerId,
type,
mode: rawMode,
callerName,
callerAvatar,
}=req.body;

const mode = normalizeCallMode(rawMode);

if (mode === CALL_MODES.QUICK_CONNECT) {
  if (receiverId) {
    return res.status(400).json({
      message: "Quick Connect does not accept receiverId",
    });
  }

  if (!callerId) {
    return res.status(400).json({
      message: "callerId required",
    });
  }

  const quickConnectResult = await createQuickConnectSession({
    callerId,
    type,
    callerName: callerName ?? null,
    callerAvatar: callerAvatar ?? null,
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



const callerUid =
Number(callerId);


const receiverUid =
Number(receiverId);



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
status:"live"
});

}else{

liveCall =
await CallHistory.create({
callerId,
receiverId,
type:normalizedType,
duration:0,
coinsSpent:0,
status:"live"
});

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
message:error.message
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

    return res.json({
      active: ACTIVE_CALL_STATUSES.includes(status),
      status,
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
