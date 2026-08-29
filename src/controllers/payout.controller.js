import {

    User,

    Kyc,

    Withdraw

} from "../models/index.js";

import {
  getFemaleWithdrawSummary,
} from "../services/withdraw.service.js";

import {
  notifyWithdrawalProcessed
} from "../services/notificationPush.service.js";




const getDisplayName =
(user)=>{


if(!user){


return "Unknown";


}


return (
user.nickname ||
(
user.name !== "New User"
? user.name
: null
) ||
user.username ||
"Unknown"
);


};




const formatPayout =
(payout)=>{


const data =
payout.toJSON();


const user =
data.user ||
{};


const kyc =
user.Kyc ||
null;


const paymentMethod =
data.upiId
? "UPI"
: (
data.accountNumber || kyc?.accountNumber
)
? "Bank"
: "—";


const paymentDetails =
data.upiId ||
[
kyc?.bankName,
kyc?.accountNumber,
kyc?.ifsc
].filter(Boolean).join(" · ") ||
"—";


return {

id:data.id,

userId:data.userId,

amount:data.amount,

status:data.status,

upiId:data.upiId,

accountName:data.accountName || kyc?.accountName || "—",

accountNumber:data.accountNumber || kyc?.accountNumber || "—",

ifsc:data.ifsc || kyc?.ifsc || "—",

bankName:kyc?.bankName || "—",

paymentMethod,

paymentDetails,

createdAt:data.createdAt,

updatedAt:data.updatedAt,

creator:{

id:user.id,

displayName:getDisplayName(user),

phone:user.phone || "—",

avatar:user.avatar,

gender:user.gender

},

kycStatus:kyc?.status || "—"

};


};






// ================================
// ADMIN WITHDRAW REQUEST LIST
// ================================


export const getPayouts =
async(
req,
res
)=>{


try{


const payouts =
await Withdraw.findAll({


include:[

{

model:User,

where:{

gender:"Female"

},

required:true,

include:[

{

model:Kyc,

required:false

}

]

}

],


order:[

[
"createdAt",

"DESC"

]

]


});




res.json(
payouts.map(formatPayout)
);



}catch(error){


console.log(
"PAYOUT ERROR",
error
);


res.status(500)
.json({

message:error.message

});


}


};








// ================================
// APPROVE PAYOUT
// ================================




export const approvePayout =
async(
req,
res
)=>{


try{


const withdraw =
await Withdraw.findByPk(

req.params.id

);




if(!withdraw){


return res.status(404)
.json({

message:"Withdraw not found"

});


}




if(
withdraw.status !== "pending"
){


return res.status(400)
.json({

message:"Payout already processed"

});


}




await withdraw.update({


status:"approved"


});

await notifyWithdrawalProcessed(
withdraw.userId,
{
status:"approved",
amount:withdraw.amount,
withdrawId:withdraw.id
}
).catch(
(error)=>{
console.log(
"WITHDRAWAL APPROVED NOTIFY ERROR",
error.message
);
}
);

const summary =
await getFemaleWithdrawSummary(withdraw.userId);




res.json({


success:true,

message:"Payout approved",

summary


});



}catch(error){


res.status(500)
.json({

message:error.message

});


}


};








// ================================
// REJECT PAYOUT
// ================================



export const rejectPayout =
async(
req,
res
)=>{


try{


const withdraw =
await Withdraw.findByPk(

req.params.id

);



if(!withdraw){


return res.status(404)
.json({

message:"Withdraw not found"

});


}




if(
withdraw.status !== "pending"
){


return res.status(400)
.json({

message:"Payout already processed"

});


}




await withdraw.update({


status:"rejected"


});

await notifyWithdrawalProcessed(
withdraw.userId,
{
status:"rejected",
amount:withdraw.amount,
withdrawId:withdraw.id
}
).catch(
(error)=>{
console.log(
"WITHDRAWAL REJECTED NOTIFY ERROR",
error.message
);
}
);

const summary =
await getFemaleWithdrawSummary(withdraw.userId);




res.json({

success:true,

message:"Payout rejected",

summary

});




}catch(error){


res.status(500)
.json({

message:error.message

});


}



};
