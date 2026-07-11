import { generateAgoraToken } from "../services/agora.service.js";
import {
areUsersBlocked
} from "../services/block.service.js";
import {
findActiveCallByPair,
getChannelNameForCall,
isReceiverBusyWithOther
} from "../services/callState.service.js";
import {
normalizeCallTypeForDb
} from "../constants/callTypes.js";
import {
CallHistory
} from "../models/index.js";

export const createVideoCall =
async(req,res)=>{


try{


const {
receiverId,
callerId,
type
}=req.body;

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
generateAgoraToken(
channelName,
callerUid
);



const receiverToken =
generateAgoraToken(
channelName,
receiverUid
);



return res.json({


success:true,


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


res.status(500).json({
message:error.message
});


}


};
