import {
claimFemaleTaskReward,
getFemaleTaskOverview,
recordFemaleOnlineHeartbeat
} from "../services/femaleTask.service.js";

export const getFemaleTasks =
async(req,res)=>{

try{

const {
userId
}=req.params;

const overview =
await getFemaleTaskOverview(userId);

return res.json(overview);

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const claimFemaleTask =
async(req,res)=>{

try{

const {
userId
}=req.params;

const {
taskId
}=req.body;

if(!taskId){
return res.status(400).json({
message:"taskId is required"
});
}

const result =
await claimFemaleTaskReward(
userId,
taskId
);

return res.json(result);

}catch(error){

const message =
error?.message ?? "Unable to claim task reward";

const status =
message.includes("already claimed")
?
409
:
message.includes("not completed")
?
400
:
message.includes("not found")
?
404
:
500;

return res.status(status).json({
message
});

}

};

export const pingFemaleTaskActivity =
async(req,res)=>{

try{

const {
userId
}=req.params;

const activity =
await recordFemaleOnlineHeartbeat(userId);

return res.json({
success:true,
activity
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};
