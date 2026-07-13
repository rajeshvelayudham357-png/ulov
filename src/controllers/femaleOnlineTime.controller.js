import {
  getFemaleOnlineTimeStats,
  recordFemaleOnlineHeartbeat,
  recordFemaleOnlineSessionEnd,
  recordFemaleOnlineSessionStart,
} from "../services/femaleOnlineTime.service.js";

export const getFemaleOnlineTime =
async(req,res)=>{

try{

const {
userId
}=req.params;

const stats =
await getFemaleOnlineTimeStats(userId);

return res.json(stats);

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const pingFemaleOnlineTime =
async(req,res)=>{

try{

const {
userId
}=req.params;

const stats =
await recordFemaleOnlineHeartbeat(userId);

return res.json({
success:true,
...stats
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const startFemaleOnlineSession =
async(req,res)=>{

try{

const {
userId
}=req.params;

const stats =
await recordFemaleOnlineSessionStart(userId);

return res.json({
success:true,
...stats
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const endFemaleOnlineSession =
async(req,res)=>{

try{

const {
userId
}=req.params;

const stats =
await recordFemaleOnlineSessionEnd(userId);

return res.json({
success:true,
...stats
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};
