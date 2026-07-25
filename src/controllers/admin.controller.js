import {
    Op,
    fn,
    col,
    QueryTypes
} from "sequelize";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



import {
    User
} from "../models/index.js";



import {
    Earning
} from "../models/index.js";



import {
    CallHistory
} from "../models/index.js";

import {
    Wallet
} from "../models/index.js";

import {
    PaymentOrder
} from "../models/index.js";

import {
    WalletTransaction,
    Favorite,
    DeviceToken,
    NotificationRecord,
    ChatMessage,
    CallRating,
    Block,
    CallGiftRecord,
    AccountDeletionRequest,
    SupportTicket,
    SupportMessage
} from "../models/index.js";

import {
    Kyc
}
from "../models/index.js";

import {
    Withdraw
}
from "../models/index.js";


import {
    sequelize
}
from "../config/database.js";

import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import {
getCallRateSettings,
updateCallRateSettings,
getCreatorCallRateSettings,
updateCreatorEarningPercentage
} from "../services/callRate.service.js";
import {
getAppSettings,
updateAppSettings
} from "../services/appSettings.service.js";
import {
getGstSettings,
updateGstSettings,
splitInclusiveGst,
} from "../services/gstSettings.service.js";
import {
getGiftSettings,
updateGiftSettings,
} from "../services/giftSettings.service.js";
import {
getAdminPaymentSettingsView,
updatePaymentSettings,
} from "../services/paymentSettings.service.js";
import {
backfillPublicUserIds
} from "../services/publicUserId.service.js";
import {
createMasterFemaleTask,
getMasterFemaleTasks,
updateMasterFemaleTask
} from "../services/femaleTask.service.js";
import {
notifyKycApproved,
notifyFemaleAccountApproved
} from "../services/notificationPush.service.js";




let blockedColumnReady =
false;

const ADMIN_EMAIL =
process.env.ADMIN_EMAIL ||
"admin@ulov.com";

const ADMIN_PASSWORD =
process.env.ADMIN_PASSWORD ||
"admin123";

const ADMIN_PASSWORD_HASH =
process.env.ADMIN_PASSWORD_HASH;

const JWT_SECRET =
process.env.JWT_SECRET ||
"ulov_secret";

const adminProfile = {
id:"admin",
name:"Ulov Admin",
email:ADMIN_EMAIL,
role:"admin",
isSuperAdmin:true,
allowedPages:["*"]
};

const ADMIN_PAGE_PERMISSIONS = [
{ key:"dashboard", label:"Dashboard", path:"/dashboard" },
{ key:"users", label:"Users", path:"/users" },
{ key:"male-users", label:"Male Users", path:"/male-users" },
{ key:"calls", label:"Calls", path:"/calls" },
{ key:"live-calls", label:"Live Calls", path:"/live-calls" },
{ key:"call-rates", label:"Call Rates", path:"/call-rates" },
{ key:"gift-master", label:"Gift Master", path:"/gift-master" },
{ key:"recharge-revenue", label:"Revenue", path:"/recharge-revenue" },
{ key:"gst-master", label:"GST Master", path:"/gst-master" },
{ key:"payment-settings", label:"Payment Settings", path:"/payment-settings" },
{ key:"auth-settings", label:"Auth Settings", path:"/auth-settings" },
{ key:"user-verification", label:"User Verification", path:"/user-verification" },
{ key:"app-settings", label:"App Settings", path:"/app-settings" },
{ key:"spin-wheel", label:"Spin Wheel", path:"/spin-wheel" },
{ key:"daily-tasks", label:"Daily Tasks", path:"/daily-tasks" },
{ key:"broadcast", label:"Broadcast", path:"/broadcast" },
{ key:"user-notify", label:"User Notify", path:"/user-notify" },
{ key:"support", label:"Support", path:"/support" },
{ key:"withdraw", label:"Withdraw", path:"/withdraw" },
{ key:"kyc", label:"KYC", path:"/kyc" },
{ key:"creators", label:"Creators", path:"/creators" },
{ key:"payouts", label:"Payouts", path:"/payouts" },
{ key:"account-deletion", label:"Account Deletion", path:"/account-deletion" },
{ key:"analytics", label:"Analytics", path:"/analytics" }
];

let adminUsersTableReady =
false;

const normalizeAllowedPages =
(pages)=>{

if(
!Array.isArray(
pages
)
){

return [];

}

const validPages =
new Set(
ADMIN_PAGE_PERMISSIONS.map(
(page)=>page.key
)
);

return [
...new Set(
pages
.map(
(page)=>String(page || "").trim()
)
.filter(
(page)=>validPages.has(page)
)
)
];

};

const parseAllowedPages =
(value)=>{

if(
Array.isArray(
value
)
){

return normalizeAllowedPages(
value
);

}

try{

return normalizeAllowedPages(
JSON.parse(
value || "[]"
)
);

}catch(error){

return [];

}

};

const ensureAdminUsersTable =
async()=>{

if(
adminUsersTableReady
){

return;

}

await sequelize.query(
`CREATE TABLE IF NOT EXISTS admin_users (
id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
name VARCHAR(120) NOT NULL,
email VARCHAR(180) NOT NULL UNIQUE,
passwordHash VARCHAR(255) NOT NULL,
allowedPages TEXT NULL,
active TINYINT(1) NOT NULL DEFAULT 1,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
);

adminUsersTableReady =
true;

};

const formatManagedAdminUser =
(row)=>({
id:String(row.id),
name:row.name,
email:row.email,
role:"admin",
isSuperAdmin:false,
active:Boolean(row.active),
allowedPages:parseAllowedPages(
row.allowedPages
),
createdAt:row.createdAt,
updatedAt:row.updatedAt
});

const findManagedAdminByEmail =
async(
email
)=>{

await ensureAdminUsersTable();

const rows =
await sequelize.query(
"SELECT * FROM admin_users WHERE LOWER(email) = LOWER(:email) LIMIT 1",
{
replacements:{
email:String(email || "").trim()
},
type:QueryTypes.SELECT
}
);

return rows[0] || null;

};

const isSuperAdminRequest =
(req)=>
Boolean(req.admin?.isSuperAdmin) ||
(
String(req.admin?.sub || "") === adminProfile.id &&
String(req.admin?.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase()
);

const isAdminPasswordValid =
async (
password
)=>{

if(
ADMIN_PASSWORD_HASH
){

return bcrypt.compare(
password,
ADMIN_PASSWORD_HASH
);

}

return password === ADMIN_PASSWORD;

};


export const adminLogin =
async (
req,
res
)=>{

try{

const {
email,
password
} = req.body;

if(
!email ||
!password
){

return res
.status(400)
.json({
message:"Email and password are required"
});

}

const emailMatches =
String(email).trim().toLowerCase() ===
ADMIN_EMAIL.toLowerCase();

const passwordMatches =
await isAdminPasswordValid(
password
);

if(
emailMatches &&
passwordMatches
){

const token =
jwt.sign(
{
sub:adminProfile.id,
email:adminProfile.email,
role:adminProfile.role,
name:adminProfile.name,
isSuperAdmin:true,
allowedPages:["*"]
},
JWT_SECRET,
{
expiresIn:"8h"
}
);

return res.json({
token,
admin:adminProfile
});

}

const managedAdmin =
await findManagedAdminByEmail(
email
);

if(
!managedAdmin ||
!managedAdmin.active
){

return res
.status(401)
.json({
message:"Invalid admin credentials"
});

}

const managedPasswordMatches =
await bcrypt.compare(
password,
managedAdmin.passwordHash
);

if(
!managedPasswordMatches
){

return res
.status(401)
.json({
message:"Invalid admin credentials"
});

}

const managedProfile =
formatManagedAdminUser(
managedAdmin
);

const token =
jwt.sign(
{
sub:managedProfile.id,
email:managedProfile.email,
role:managedProfile.role,
name:managedProfile.name,
isSuperAdmin:false,
allowedPages:managedProfile.allowedPages
},
JWT_SECRET,
{
expiresIn:"8h"
}
);

return res.json({
token,
admin:managedProfile
});

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const requireAdmin =
(
req,
res,
next
)=>{

try{

const authHeader =
req.headers.authorization;

if(
!authHeader ||
!authHeader.startsWith("Bearer ")
){

return res
.status(401)
.json({
message:"Admin session required"
});

}

const token =
authHeader.split(" ")[1];

const decoded =
jwt.verify(
token,
JWT_SECRET
);

if(
decoded.role !== "admin"
){

return res
.status(403)
.json({
message:"Admin access required"
});

}

req.admin =
decoded;

next();

}catch(error){

return res
.status(401)
.json({
message:"Admin session expired"
});

}

};


export const requireSuperAdmin =
(
req,
res,
next
)=>{

if(
isSuperAdminRequest(
req
)
){

return next();

}

return res
.status(403)
.json({
message:"Super admin access required"
});

};


export const requirePageAccess =
(pageKey)=>(
req,
res,
next
)=>{

if(
isSuperAdminRequest(
req
)
){

return next();

}

const allowedPages =
Array.isArray(
req.admin?.allowedPages
)
? req.admin.allowedPages
: [];

const requiredPages =
Array.isArray(pageKey)
? pageKey
: [pageKey];

if(
requiredPages.some(
(key)=>allowedPages.includes(key)
)
){

return next();

}

return res
.status(403)
.json({
message:"You do not have access to this page"
});

};


export const adminMe =
async (
req,
res
)=>{

return res.json({
admin:{
id:String(
req.admin?.sub || adminProfile.id
),
name:req.admin?.name || adminProfile.name,
email:req.admin?.email || adminProfile.email,
role:"admin",
isSuperAdmin:isSuperAdminRequest(
req
),
allowedPages:isSuperAdminRequest(
req
)
? ["*"]
: (
Array.isArray(
req.admin?.allowedPages
)
? req.admin.allowedPages
: []
)
}
});

};


export const adminPagePermissions =
async (
req,
res
)=>{

return res.json({
pages:ADMIN_PAGE_PERMISSIONS
});

};


export const listAdminUsers =
async (
req,
res
)=>{

try{

await ensureAdminUsersTable();

const rows =
await sequelize.query(
"SELECT id, name, email, allowedPages, active, createdAt, updatedAt FROM admin_users ORDER BY createdAt DESC",
{
type:QueryTypes.SELECT
}
);

return res.json({
rows:rows.map(
formatManagedAdminUser
),
pages:ADMIN_PAGE_PERMISSIONS
});

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const createAdminUser =
async (
req,
res
)=>{

try{

await ensureAdminUsersTable();

const name =
String(req.body.name || "").trim();
const email =
String(req.body.email || "").trim().toLowerCase();
const password =
String(req.body.password || "");
const allowedPages =
normalizeAllowedPages(
req.body.allowedPages
);

if(
!name ||
!email ||
!password
){

return res
.status(400)
.json({
message:"Name, email, and password are required"
});

}

if(
password.length < 6
){

return res
.status(400)
.json({
message:"Password must be at least 6 characters"
});

}

if(
allowedPages.length === 0
){

return res
.status(400)
.json({
message:"Select at least one page access"
});

}

if(
email === ADMIN_EMAIL.toLowerCase()
){

return res
.status(400)
.json({
message:"This email is reserved for the main admin"
});

}

const existing =
await findManagedAdminByEmail(
email
);

if(
existing
){

return res
.status(409)
.json({
message:"Admin user already exists"
});

}

const passwordHash =
await bcrypt.hash(
password,
10
);

await sequelize.query(
`INSERT INTO admin_users (name, email, passwordHash, allowedPages, active, createdAt, updatedAt)
VALUES (:name, :email, :passwordHash, :allowedPages, 1, NOW(), NOW())`,
{
replacements:{
name,
email,
passwordHash,
allowedPages:JSON.stringify(
allowedPages
)
}
}
);

return res
.status(201)
.json({
message:"Admin user created"
});

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const updateAdminUser =
async (
req,
res
)=>{

try{

await ensureAdminUsersTable();

const id =
String(req.params.id || "").trim();
const name =
String(req.body.name || "").trim();
const allowedPages =
normalizeAllowedPages(
req.body.allowedPages
);
const active =
req.body.active === undefined
? true
: Boolean(req.body.active);
const password =
String(req.body.password || "");

if(
!id ||
!name
){

return res
.status(400)
.json({
message:"Admin user and name are required"
});

}

if(
allowedPages.length === 0
){

return res
.status(400)
.json({
message:"Select at least one page access"
});

}

const replacements = {
id,
name,
allowedPages:JSON.stringify(
allowedPages
),
active:active ? 1 : 0
};

let passwordSql =
"";

if(
password
){

if(
password.length < 6
){

return res
.status(400)
.json({
message:"Password must be at least 6 characters"
});

}

replacements.passwordHash =
await bcrypt.hash(
password,
10
);
passwordSql =
", passwordHash = :passwordHash";

}

await sequelize.query(
`UPDATE admin_users
SET name = :name,
allowedPages = :allowedPages,
active = :active
${passwordSql},
updatedAt = NOW()
WHERE id = :id`,
{
replacements
}
);

return res.json({
message:"Admin user updated"
});

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const getCallRateConfig =
async(
req,
res
)=>{

try{

const settings =
await getCallRateSettings();

return res.json(
settings
);

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const updateCallRateConfig =
async(
req,
res
)=>{

try{

const settings =
await updateCallRateSettings({
voiceRatePerMinute:req.body.voiceRatePerMinute,
videoRatePerMinute:req.body.videoRatePerMinute,
femaleEarningPercentage:req.body.femaleEarningPercentage
});

return res.json({
message:"Call rate settings updated",
settings
});

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const getAppSettingsConfig =
async(
req,
res
)=>{

try{

const settings =
await getAppSettings();

return res.json(
settings
);

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const updateAppSettingsConfig =
async(
req,
res
)=>{

try{

const settings =
await updateAppSettings({
languageMatchingEnabled:
req.body.languageMatchingEnabled,
welcomeOfferEnabled:
req.body.welcomeOfferEnabled,
welcomeOfferCoins:
req.body.welcomeOfferCoins,
authVerificationMode:
req.body.authVerificationMode,
femaleVerificationMethod:
req.body.femaleVerificationMethod,
});

return res.json({
message:"App settings updated",
settings
});

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const getGiftSettingsConfig =
async(
req,
res
)=>{

try{

const settings =
await getGiftSettings();

return res.json(
settings
);

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const updateGiftSettingsConfig =
async(
req,
res
)=>{

try{

const settings =
await updateGiftSettings({
femaleEarnPercent:
req.body.femaleEarnPercent
});

return res.json({
message:"Gift settings updated",
settings
});

}catch(error){

return res
.status(400)
.json({
message:error.message
});

}

};


export const getGstSettingsConfig =
async(
req,
res
)=>{

try{

const settings =
await getGstSettings();

return res.json(
settings
);

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const updateGstSettingsConfig =
async(
req,
res
)=>{

try{

const settings =
await updateGstSettings({
gstPercent:
req.body.gstPercent
});

return res.json({
message:"GST settings updated",
settings
});

}catch(error){

return res
.status(400)
.json({
message:error.message
});

}

};


export const getPaymentSettingsConfig =
async(
req,
res
)=>{

try{

const settings =
await getAdminPaymentSettingsView();

return res.json(
settings
);

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const updatePaymentSettingsConfig =
async(
req,
res
)=>{

try{

const settings =
await updatePaymentSettings(
req.body || {}
);

return res.json({
message:"Payment settings updated",
settings
});

}catch(error){

return res
.status(400)
.json({
message:error.message
});

}

};


export const getCreatorCallRateConfig =
async(
req,
res
)=>{

try{

await backfillPublicUserIds();

const creators =
await getCreatorCallRateSettings();

return res.json(
creators
);

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const updateCreatorCallRateConfig =
async(
req,
res
)=>{

try{

const creatorId =
req.params.id;

const result =
await updateCreatorEarningPercentage(
creatorId,
req.body.femaleEarningPercentage
);

return res.json({
message:"Creator earning percentage updated",
setting:result
});

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const getMasterTasks =
async(
req,
res
)=>{

try{

const tasks =
await getMasterFemaleTasks({
includeInactive:true
});

return res.json(
tasks
);

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const createMasterTask =
async(
req,
res
)=>{

try{

const task =
await createMasterFemaleTask(
req.body
);

return res
.status(201)
.json(
task
);

}catch(error){

return res
.status(500)
.json({
message:error.message
});

}

};


export const updateMasterTask =
async(
req,
res
)=>{

try{

const task =
await updateMasterFemaleTask(
req.params.id,
req.body
);

return res.json(
task
);

}catch(error){

const message =
error?.message || "Unable to update task";

return res
.status(
message.includes("not found") ? 404 : 500
)
.json({
message
});

}

};




const ensureBlockedColumn =
async()=>{


if(
blockedColumnReady
){


return;


}




try{


await sequelize.query(
"SELECT blocked FROM users LIMIT 1"
);


}catch(error){


await sequelize.query(
"ALTER TABLE users ADD COLUMN blocked TINYINT(1) NOT NULL DEFAULT 0"
);


}




blockedColumnReady =
true;


};




let accountStatusColumnReady =
false;




const ensureAccountStatusColumn =
async()=>{


if(
accountStatusColumnReady
){


return;


}




try{


await sequelize.query(
"SELECT accountStatus FROM users LIMIT 1"
);


}catch(error){


await sequelize.query(
"ALTER TABLE users ADD COLUMN accountStatus VARCHAR(20) NOT NULL DEFAULT 'pending'"
);


await sequelize.query(
"UPDATE users SET accountStatus = 'approved' WHERE gender = 'Female' AND verified = 1"
);


await sequelize.query(
"UPDATE users SET accountStatus = 'active' WHERE gender IS NULL OR gender != 'Female'"
);


}




accountStatusColumnReady =
true;


};





const parseRejectionReasons =
(value)=>{
if(Array.isArray(value)){
return value
.map((item)=>String(item || "").trim())
.filter(Boolean);
}

if(typeof value === "string" && value.trim()){
try{
const parsed =
JSON.parse(value);

if(Array.isArray(parsed)){
return parsed
.map((item)=>String(item || "").trim())
.filter(Boolean);
}
}catch(_error){
return value
.split("|")
.map((item)=>item.trim())
.filter(Boolean);
}
}

return [];
};

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




const formatAdminUser =
(user)=>{


const data =
user.toJSON();


const isFemale =
data.gender === "Female";


const accountStatus =
data.accountStatus ||
(
isFemale
? "pending"
: "active"
);


return {

id:data.id,

publicUserId:data.publicUserId,

name:data.name,

username:data.username,

nickname:data.nickname,

displayName:getDisplayName(
data
),

email:data.email,

phone:data.phone,

gender:data.gender,

age:data.age,

avatar:data.avatar,

bio:data.bio,

preferredAge:data.preferredAge,

interests:data.interests,

languages:data.languages,

verificationType:data.verificationType,

audioVerified:data.audioVerified,

videoVerified:data.videoVerified,

verificationAudioUrl:data.verificationAudioUrl,

verificationVideoUrl:data.verificationVideoUrl,

verificationSentence:data.verificationSentence,

verified:data.verified,

accountStatus,

rejectionReasons:parseRejectionReasons(
data.rejectionReasons
),

online:data.online,

lastSeen:data.lastSeen,

profileCompleted:data.profileCompleted,

likes:data.likes,

totalCalls:data.totalCalls,

blocked:Boolean(
data.blocked
),

createdAt:data.createdAt,

updatedAt:data.updatedAt

};


};



// ===================================
// LIVE CALLS
// ===================================


export const liveCalls =
async(
req,
res
)=>{

try{

const activeStatuses = [
"live",
"ongoing",
"in_progress",
"accepted"
];

const staleMinutes =
Number(
process.env.LIVE_CALL_STALE_MINUTES || 240
);

const staleCutoff =
new Date(
Date.now() -
staleMinutes *
60 *
1000
);

await CallHistory.update(
{
status:"cancelled"
},
{
where:{
status:{
[Op.in]:activeStatuses
},
createdAt:{
[Op.lt]:staleCutoff
}
}
}
);

const data =
await CallHistory.findAll({
where:{
status:{
[Op.in]:activeStatuses
}
},
limit:100,
include:[
{
model:User,
as:"caller",
attributes:[
"id",
"name",
"nickname",
"username",
"phone",
"online"
]
},
{
model:User,
as:"receiver",
attributes:[
"id",
"name",
"nickname",
"username",
"phone",
"online"
]
},
{
model:Earning,
as:"earning",
attributes:[
"coins",
"amount"
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

const formatDuration =
(seconds)=>{

const total =
Number(seconds) || 0;

const mins =
Math.floor(
total / 60
);

const secs =
total % 60;

return `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;

};

const formatted =
data.map(
(call)=>{

const row =
call.toJSON();

const coins =
row.coinsSpent ||
row.earning?.coins ||
0;

const startedAt =
new Date(
row.createdAt
);

const elapsedSeconds =
Math.max(
0,
Math.floor(
(Date.now() - startedAt.getTime()) / 1000
)
);

return {
id:row.id,
callerId:row.callerId,
receiverId:row.receiverId,
male:getDisplayName(
row.caller
),
female:getDisplayName(
row.receiver
),
callerPhone:row.caller?.phone || "—",
receiverPhone:row.receiver?.phone || "—",
callerOnline:Boolean(row.caller?.online),
receiverOnline:Boolean(row.receiver?.online),
duration:formatDuration(
row.duration || elapsedSeconds
),
elapsedSeconds,
coins:Number(coins) || 0,
earning:Number(row.earning?.amount || 0),
type:row.type || "video",
status:row.status || "live",
startedAt:row.createdAt
};

}
);

return res.json(
formatted
);

}catch(error){

console.log(
"ADMIN LIVE CALLS ERROR",
error
);

return res
.status(500)
.json({
message:error.message
});

}

};






// ===================================
// DASHBOARD
// ===================================


export const dashboard =
async (
req,
res
)=>{


try{


await ensureAccountStatusColumn();


const totalUsers =
await User.count();




const femaleCreators =
await User.count({

where:{

gender:"Female"

}

});




const [
pendingFemaleResult
]=
await sequelize.query(
`SELECT COUNT(*) AS count FROM users WHERE gender = 'Female' AND COALESCE(accountStatus, 'pending') = 'pending'`,

{
type:sequelize.QueryTypes.SELECT
}

);


const pendingFemaleApprovals =
Number(
pendingFemaleResult?.count ||
0
);




const totalCalls =
await CallHistory.count();




const liveCalls =
await CallHistory.count({

where:{

status:"live"

}

});




const totalRevenue =
await Earning.sum(
"amount"
) || 0;




const totalPayoutAmount =
await Withdraw.sum(
"amount"
) || 0;




const pendingPayouts =
await Withdraw.count({

where:{
status:"pending"
}

});




const approvedPayouts =
await Withdraw.count({

where:{
status:"approved"
}

});




const rejectedPayouts =
await Withdraw.count({

where:{
status:"rejected"
}

});




const pendingPayoutAmount =
await Withdraw.sum(
"amount",
{
where:{
status:"pending"
}
}
) || 0;




const approvedPayoutAmount =
await Withdraw.sum(
"amount",
{
where:{
status:"approved"
}
}
) || 0;




const totalPayouts =
await Withdraw.count();




const [
kycApproved,
kycPending,
kycRejected,
kycTotal
] =
await Promise.all([
Kyc.count({
where:{
status:"approved"
}
}),
Kyc.count({
where:{
status:"pending"
}
}),
Kyc.count({
where:{
status:"rejected"
}
}),
Kyc.count()
]);




res.json({


totalUsers,

femaleCreators,

pendingFemaleApprovals,

totalCalls,

liveCalls,

totalRevenue,

payouts:{

total:totalPayouts,

totalAmount:totalPayoutAmount,

pending:pendingPayouts,

pendingAmount:pendingPayoutAmount,

approved:approvedPayouts,

approvedAmount:approvedPayoutAmount,

rejected:rejectedPayouts

},

kyc:{

total:kycTotal,

pending:kycPending,

approved:kycApproved,

rejected:kycRejected

}


});



}catch(error){



console.log(

"ADMIN DASHBOARD ERROR",

error

);



res.status(500)
.json({

message:error.message

});


}


};





// ===================================
// USERS
// ===================================

export const users =
async(
req,
res
)=>{


try{


await ensureBlockedColumn();


await ensureAccountStatusColumn();


await backfillPublicUserIds();


const search =
String(
req.query.search ||
""
).trim();


const where =
search
? {

[Op.or]:[

{ name:{ [Op.like]:`%${search}%` } },

{ nickname:{ [Op.like]:`%${search}%` } },

{ username:{ [Op.like]:`%${search}%` } },

{ publicUserId:{ [Op.like]:`%${search}%` } },

{ phone:{ [Op.like]:`%${search}%` } },

{ email:{ [Op.like]:`%${search}%` } },

{ gender:{ [Op.like]:`%${search}%` } }

]

}
: {};




const usersList =
await User.findAll({


where,


attributes:{

include:[

[
sequelize.literal(
"COALESCE(users.blocked, 0)"
),
"blocked"
],

[
sequelize.literal(
"COALESCE(users.accountStatus, 'pending')"
),
"accountStatus"
]

]

},


order:[

[
"createdAt",

"DESC"

]

]


});




const formatted =
usersList.map(
formatAdminUser
);




res.json(

formatted

);



}catch(error){


console.log(
"ADMIN USERS ERROR",
error
);


res.status(500)
.json({

message:error.message

});


}


};


// ===================================
// MALE USERS WITH RECHARGE SUMMARY
// ===================================


export const maleUsers =
async(
req,
res
)=>{

try{

await backfillPublicUserIds();

const search =
String(
req.query.search || ""
).trim();

const where = {
gender:{
[Op.in]:[
"Male",
"male"
]
}
};

const usersList =
await User.findAll({
where,
include:[
{
model:Wallet,
as:"wallet",
required:false,
attributes:[
"balance"
]
},
{
model:PaymentOrder,
as:"paymentOrders",
required:false,
where:{
status:"PAID"
},
attributes:[
"id",
"orderId",
"coins",
"amount",
"paymentMethod",
"cashfreePaymentId",
"updatedAt"
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

const rowsAll =
usersList.map(
(user)=>{

const data =
user.toJSON();

const payments =
data.paymentOrders || [];

const totalRechargeAmount =
payments.reduce(
(sum,payment)=>
sum + Number(payment.amount || 0),
0
);

const totalRechargeCoins =
payments.reduce(
(sum,payment)=>
sum + Number(payment.coins || 0),
0
);

const latestPayment =
payments
.slice()
.sort(
(a,b)=>
new Date(b.updatedAt).getTime() -
new Date(a.updatedAt).getTime()
)[0];

return {
id:data.id,
publicUserId:data.publicUserId,
displayName:getDisplayName(
data
),
name:data.name,
username:data.username,
phone:data.phone,
email:data.email,
avatar:data.avatar,
gender:data.gender,
online:data.online,
walletBalance:Number(data.wallet?.balance || 0),
totalRechargeAmount,
totalRechargeCoins,
rechargeCount:payments.length,
latestRechargeAt:latestPayment?.updatedAt || null,
latestOrderId:latestPayment?.orderId || "—",
latestPaymentMethod:latestPayment?.paymentMethod || "—",
createdAt:data.createdAt
};

}
);

const compactSearch =
search
.toLowerCase()
.replace(
/[^a-z0-9]/g,
""
);

const rows =
search
? rowsAll.filter(
(row)=>{

const values = [
row.id,
row.publicUserId,
row.displayName,
row.name,
row.username,
row.phone,
row.email,
row.walletBalance,
row.totalRechargeAmount,
row.totalRechargeCoins,
row.rechargeCount,
row.latestOrderId,
row.latestPaymentMethod,
row.latestRechargeAt
]
.filter(Boolean)
.map(
(value)=>
String(value).toLowerCase()
);

return values.some(
(value)=>{

const compactValue =
value.replace(
/[^a-z0-9]/g,
""
);

return value.includes(search.toLowerCase()) ||
(
compactSearch &&
compactValue.includes(
compactSearch
)
);

}
);

}
)
: rowsAll;

const summary =
rows.reduce(
(acc,row)=>{

acc.totalUsers += 1;
acc.totalRechargeAmount += row.totalRechargeAmount;
acc.totalRechargeCoins += row.totalRechargeCoins;
acc.totalRecharges += row.rechargeCount;
acc.walletBalance += row.walletBalance;

return acc;

},
{
totalUsers:0,
totalRechargeAmount:0,
totalRechargeCoins:0,
totalRecharges:0,
walletBalance:0
}
);

return res.json({
summary,
rows
});

}catch(error){

console.log(
"ADMIN MALE USERS ERROR",
error
);

return res
.status(500)
.json({
message:error.message
});

}

};





// ===================================
// CALL HISTORY
// ===================================


export const calls =
async(
req,
res
)=>{


try{

const date =
String(req.query.date || "").trim();

const where = {};

if(date){

const start =
new Date(`${date}T00:00:00`);
const end =
new Date(start);
end.setDate(
end.getDate() + 1
);

where.createdAt = {
[Op.gte]:start,
[Op.lt]:end
};

}


const data =
await CallHistory.findAll({


limit:100,

where,


include:[

{

model:User,

as:"caller",

attributes:[

"id",

"name",

"nickname",

"username"

]

},

{

model:User,

as:"receiver",

attributes:[

"id",

"name",

"nickname",

"username"

]

},

{

model:Earning,

as:"earning",

attributes:[

"coins",

"amount"

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





const formatDuration =
(seconds)=>{


const total =
Number(seconds) || 0;


const mins =
Math.floor(
total / 60
);


const secs =
total % 60;


return `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;


};





const formatted =
data.map(
(call)=>{


const row =
call.toJSON();


const coins =
row.coinsSpent ||
row.earning?.coins ||
0;


const earning =
row.earning?.amount ??
Math.floor(
coins * 0.5
);


return {

id:row.id,

male:getDisplayName(
row.caller
),

female:getDisplayName(
row.receiver
),

duration:formatDuration(
row.duration
),

coins,

earning,

type:row.type ||
"video",

status:row.status ||
"completed",

startedAt:row.createdAt,

createdAt:row.createdAt

};


}
);




res.json(

formatted

);




}catch(error){


res.status(500)
.json({

message:error.message

});


}



};












// ===================================
// TOP FEMALE CREATORS
// ===================================


export const creators =
async(
req,
res
)=>{


try{


await backfillPublicUserIds();


const creators =
await User.findAll({


where:{

gender:"Female"

},


attributes:[

"id",

"publicUserId",

"name",

"nickname",

"username",

"avatar",

"gender",

"verified",

"profileCompleted",

"online",

"createdAt",

[

fn(
"COALESCE",
fn(
"SUM",
col("earnings.coins")
),
0
),

"totalCoins"

],

[

fn(
"COALESCE",
fn(
"SUM",
col("earnings.amount")
),
0
),

"totalAmount"

]

],



include:[

{

model:Earning,

as:"earnings",

attributes:[]

}

],


group:[

"users.id"

],


subQuery:false,


order:[

[
"createdAt",

"DESC"

]

]


});





const formatted =
creators.map(
(creator)=>{


const data =
creator.toJSON();


return {

id:data.id,

publicUserId:data.publicUserId,

name:data.name,

username:data.username,

displayName:getDisplayName(
data
),

nickname:
data.nickname ||
(
data.name !== "New User"
? data.name
: null
) ||
data.username ||
"Unknown",

image:data.avatar,

gender:data.gender,

verified:data.verified,

profileCompleted:data.profileCompleted,

online:data.online,

createdAt:data.createdAt,

earnings:{

coins:
Number(data.totalCoins) || 0,

amount:
Number(data.totalAmount) || 0

}

};


}
);




res.json(

formatted

);




}catch(error){


console.log(
"CREATOR ERROR",
error
);


res.status(500)
.json({

message:error.message

});


}


};










// ===================================
// CREATOR DETAILS
// ===================================


export const getCreatorDetails =
async(
req,
res
)=>{


try{


await ensureAccountStatusColumn();


await ensureBlockedColumn();


await backfillPublicUserIds();


const user =
await User.findOne({

where:{

id:req.params.id,

gender:"Female"

},

include:[

{

model:Kyc,

required:false

}

]

});




if(!user){


return res.status(404)
.json({

message:"Creator not found"

});


}




const userId =
user.id;




const totalEarnings =
await Earning.findOne({

attributes:[

[fn("COALESCE", fn("SUM", col("coins")), 0), "coins"],

[fn("COALESCE", fn("SUM", col("amount")), 0), "amount"]

],

where:{

userId

},

raw:true

});




const totalCalls =
await CallHistory.count({

where:{

receiverId:userId

}

});




const totalWithdrawals =
await Withdraw.sum(

"amount",

{

where:{

userId

}

}

) || 0;




const withdrawalCount =
await Withdraw.count({

where:{

userId

}

});




const callActivity =
await CallHistory.findAll({

attributes:[

[fn("DATE", col("createdAt")), "date"],

[fn("SUM", col("duration")), "onlineSeconds"],

[fn("SUM", col("coinsSpent")), "totalCoins"],

[fn("COUNT", col("id")), "calls"]

],

where:{

receiverId:userId

},

group:[fn("DATE", col("createdAt"))],

order:[[fn("DATE", col("createdAt")), "DESC"]],

limit:30,

raw:true

});




const [
blockedRow
]=
await sequelize.query(
"SELECT COALESCE(blocked, 0) AS blocked FROM users WHERE id = :id",

{
replacements:{ id:userId },
type:sequelize.QueryTypes.SELECT
}

);




const [
statusRow
]=
await sequelize.query(
"SELECT COALESCE(accountStatus, 'pending') AS accountStatus FROM users WHERE id = :id",

{
replacements:{ id:userId },
type:sequelize.QueryTypes.SELECT
}

);




const profile =
formatAdminUser({

toJSON:()=>({

...user.toJSON(),

blocked:blockedRow?.blocked,

accountStatus:statusRow?.accountStatus

})

});




const dailyActivity =
callActivity.map(
(row)=>{


const onlineMinutes =
Math.ceil(
Number(row.onlineSeconds || 0) / 60
);


const offlineMinutes =
Math.max(
0,
1440 - onlineMinutes
);


return {

date:row.date,

onlineMinutes,

offlineMinutes,

onlineLabel:`${Math.floor(onlineMinutes/60)}h ${onlineMinutes%60}m`,

offlineLabel:`${Math.floor(offlineMinutes/60)}h ${offlineMinutes%60}m`,

calls:Number(row.calls || 0),

totalCoins:Number(row.totalCoins || 0)

};


}
);




res.json({

profile,

stats:{

totalEarnings:{

coins:Number(totalEarnings?.coins || 0),

amount:Number(totalEarnings?.amount || 0)

},

totalCalls,

totalWithdrawals:Number(totalWithdrawals),

withdrawalCount

},

dailyActivity

});




}catch(error){


console.log(
"CREATOR DETAILS ERROR",
error
);


res.status(500)
.json({

message:error.message

});


}


};






// ===================================
// CREATOR DAY CALLS
// ===================================


export const getCreatorDayCalls =
async(
req,
res
)=>{


try{


const date =
String(
req.query.date ||
""
).trim();


if(
!date
){


return res.status(400)
.json({

message:"date query param is required (YYYY-MM-DD)"

});


}




const user =
await User.findOne({

where:{

id:req.params.id,

gender:"Female"

}

});




if(
!user
){


return res.status(404)
.json({

message:"Creator not found"

});


}




const calls =
await CallHistory.findAll({

where:{

receiverId:user.id,

[Op.and]:[
sequelize.where(
fn(
"DATE",
col("call_histories.createdAt")
),
date
)
]

},

include:[

{

model:User,

as:"caller",

attributes:[

"id",

"name",

"username",

"nickname",

"phone"

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




const formatCallDuration =
(seconds)=>{


const total =
Number(seconds) || 0;


const mins =
Math.floor(
total / 60
);


const secs =
total % 60;


return `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;


};




const formattedCalls =
calls.map(
(call)=>{


const row =
call.toJSON();


const caller =
row.caller ||
{};


return {

id:row.id,

callerId:row.callerId,

callerName:getDisplayName(
caller
),

callerPhone:caller.phone || "—",

duration:formatCallDuration(
row.duration
),

durationSeconds:row.duration,

coinsSpent:Number(
row.coinsSpent || 0
),

type:row.type || "video",

status:row.status || "completed",

time:new Date(
row.createdAt
).toLocaleTimeString(
"en-IN",
{
hour:"2-digit",
minute:"2-digit"
}
)

};


}
);




const totalCoinsSpent =
formattedCalls.reduce(
(sum,
call
)=>
sum + call.coinsSpent,
0
);




res.json({

date,

totalCoinsSpent,

calls:formattedCalls

});




}catch(error){


console.log(
"CREATOR DAY CALLS ERROR",
error
);


res.status(500)
.json({

message:error.message

});


}


};


// ===================================
// ANALYTICS OVERVIEW
// ===================================


export const analytics =
async(
req,
res
)=>{

try{

const days =
Math.min(
Math.max(
Number(req.query.days) || 30,
1
),
90
);

const startDate =
new Date();

startDate.setHours(
0,
0,
0,
0
);

startDate.setDate(
startDate.getDate() - (days - 1)
);

const dateKey =
(date)=>
date.toISOString().slice(
0,
10
);

const dailyMap =
new Map();

for(
let i = 0;
i < days;
i += 1
){

const day =
new Date(
startDate
);

day.setDate(
startDate.getDate() + i
);

dailyMap.set(
dateKey(day),
{
date:dateKey(day),
label:day.toLocaleDateString(
"en-IN",
{
day:"2-digit",
month:"short"
}
),
totalUsers:0,
maleUsers:0,
femaleUsers:0,
onlineUsers:0,
offlineUsers:0,
totalCalls:0,
coinsSpent:0,
revenue:0
}
);

}

const userRows =
await sequelize.query(
`SELECT
DATE(createdAt) AS date,
COUNT(*) AS totalUsers,
SUM(CASE WHEN gender = 'Male' THEN 1 ELSE 0 END) AS maleUsers,
SUM(CASE WHEN gender = 'Female' THEN 1 ELSE 0 END) AS femaleUsers,
SUM(CASE WHEN online = 1 THEN 1 ELSE 0 END) AS onlineUsers,
SUM(CASE WHEN online = 1 THEN 0 ELSE 1 END) AS offlineUsers
FROM users
WHERE createdAt >= :startDate
GROUP BY DATE(createdAt)
ORDER BY DATE(createdAt) ASC`,
{
replacements:{
startDate
},
type:QueryTypes.SELECT
}
);

userRows.forEach(
(row)=>{

const key =
String(row.date).slice(
0,
10
);

const day =
dailyMap.get(
key
);

if(
day
){

day.totalUsers =
Number(row.totalUsers) || 0;

day.maleUsers =
Number(row.maleUsers) || 0;

day.femaleUsers =
Number(row.femaleUsers) || 0;

day.onlineUsers =
Number(row.onlineUsers) || 0;

day.offlineUsers =
Number(row.offlineUsers) || 0;

}

}
);

const callRows =
await sequelize.query(
`SELECT
DATE(createdAt) AS date,
COUNT(*) AS totalCalls,
SUM(COALESCE(coinsSpent, 0)) AS coinsSpent
FROM call_histories
WHERE createdAt >= :startDate
GROUP BY DATE(createdAt)
ORDER BY DATE(createdAt) ASC`,
{
replacements:{
startDate
},
type:QueryTypes.SELECT
}
);

callRows.forEach(
(row)=>{

const key =
String(row.date).slice(
0,
10
);

const day =
dailyMap.get(
key
);

if(
day
){

day.totalCalls =
Number(row.totalCalls) || 0;

day.coinsSpent =
Number(row.coinsSpent) || 0;

}

}
);

const earningRows =
await Earning.findAll({
attributes:[
[
fn(
"DATE",
col("createdAt")
),
"date"
],
[
fn(
"SUM",
col("amount")
),
"revenue"
]
],
where:{
createdAt:{
[Op.gte]:startDate
}
},
group:[
fn(
"DATE",
col("createdAt")
)
],
raw:true
});

earningRows.forEach(
(row)=>{

const key =
String(row.date).slice(
0,
10
);

const day =
dailyMap.get(
key
);

if(
day
){

day.revenue =
Number(row.revenue) || 0;

}

}
);

const topCreators =
await User.findAll({
where:{
gender:"Female"
},
attributes:[
"id",
"name",
"nickname",
"username",
"avatar",
"online",
[
fn(
"COALESCE",
fn(
"SUM",
col("earnings.coins")
),
0
),
"totalCoins"
],
[
fn(
"COALESCE",
fn(
"SUM",
col("earnings.amount")
),
0
),
"totalAmount"
],
[
fn(
"COUNT",
col("earnings.id")
),
"earningCount"
]
],
include:[
{
model:Earning,
as:"earnings",
attributes:[]
}
],
group:[
"users.id"
],
subQuery:false,
order:[
[
fn(
"SUM",
col("earnings.amount")
),
"DESC"
]
],
limit:10
});

const creatorCallRows =
await CallHistory.findAll({
attributes:[
"receiverId",
[
fn(
"COUNT",
col("id")
),
"callCount"
],
[
fn(
"SUM",
col("duration")
),
"durationSeconds"
]
],
group:[
"receiverId"
],
raw:true
});

const creatorCallMap =
new Map(
creatorCallRows.map(
(row)=>[
String(row.receiverId),
{
callCount:Number(row.callCount) || 0,
durationSeconds:Number(row.durationSeconds) || 0
}
]
)
);

const formattedTopCreators =
topCreators.map(
(creator)=>{

const data =
creator.toJSON();

const callStats =
creatorCallMap.get(
String(data.id)
) || {
callCount:0,
durationSeconds:0
};

return {
id:data.id,
name:getDisplayName(
data
),
avatar:data.avatar,
online:Boolean(data.online),
totalCoins:Number(data.totalCoins) || 0,
totalAmount:Number(data.totalAmount) || 0,
callCount:callStats.callCount,
durationSeconds:callStats.durationSeconds
};

}
);

const [
totalUsers,
maleUsers,
femaleUsers,
onlineUsers,
totalCalls
] =
await Promise.all([
User.count(),
User.count({
where:{
gender:"Male"
}
}),
User.count({
where:{
gender:"Female"
}
}),
User.count({
where:{
online:true
}
}),
CallHistory.count()
]);

const daily =
Array.from(
dailyMap.values()
);

return res.json({
summary:{
totalUsers,
maleUsers,
femaleUsers,
onlineUsers,
offlineUsers:Math.max(
totalUsers - onlineUsers,
0
),
totalCalls,
registeredToday:daily[daily.length - 1]?.totalUsers || 0,
callsToday:daily[daily.length - 1]?.totalCalls || 0
},
daily,
topCreators:formattedTopCreators,
updatedAt:new Date().toISOString()
});

}catch(error){

console.log(
"ADMIN ANALYTICS ERROR",
error
);

return res
.status(500)
.json({
message:error.message
});

}

};


// ===================================
// REVENUE CHART
// ===================================


export const revenue =
async(
req,
res
)=>{


try{



const data =
await Earning.findAll({



attributes:[



[

fn(
"DATE",
col("createdAt")
),

"date"

],




[

fn(
"SUM",
col("amount")
),

"amount"

]


],




group:[

"date"

],




order:[

[
"date",

"ASC"

]

]


});






res.json(
data
);




}catch(error){



res.status(500)
.json({

message:error.message

});



}



};


// ===================================
// RECHARGE REVENUE
// ===================================


export const rechargeRevenue =
async(
req,
res
)=>{

try{

const limit =
Math.min(
Number(req.query.limit) || 200,
500
);

const search =
String(
req.query.search || ""
).trim()
.toLowerCase();

const compactSearch =
search.replace(
/[^a-z0-9]/g,
""
);

await backfillPublicUserIds();

const gstSettings =
await getGstSettings();

const gstPercent =
Number(gstSettings.gstPercent) || 0;

const applyGstBreakdown =
(row)=>{

const breakdown =
splitInclusiveGst(
row.amount,
gstPercent
);

return {
...row,
inclusiveAmount:breakdown.inclusiveAmount,
gstAmount:breakdown.gstAmount,
baseRevenue:breakdown.baseRevenue,
gstPercent:breakdown.gstPercent,
};

};

const getDateBounds =
()=>{

const startDate =
String(req.query.startDate || "").trim();

const endDate =
String(req.query.endDate || "").trim();

const month =
String(req.query.month || "").trim();

let start =
null;

let end =
null;

if(
startDate ||
endDate
){

if(startDate){
start =
new Date(`${startDate}T00:00:00`);
}

if(endDate){
end =
new Date(`${endDate}T00:00:00`);
end.setDate(
end.getDate() + 1
);
}

}else if(
month
){

start =
new Date(`${month}-01T00:00:00`);

end =
new Date(start);

end.setMonth(
end.getMonth() + 1
);

}

const where = {};

if(start){
where[Op.gte] =
start;
}

if(end){
where[Op.lt] =
end;
}

return Object.keys(where).length
? where
: null;

};

const dateBounds =
getDateBounds();

const paymentWhere = {
status:"PAID"
};

if(dateBounds){
paymentWhere.updatedAt =
dateBounds;
}

const paidOrders =
await PaymentOrder.findAll({
where:paymentWhere,
include:[
{
model:User,
attributes:[
"id",
"publicUserId",
"name",
"nickname",
"username",
"phone",
"gender"
]
}
],
order:[
[
"updatedAt",
"DESC"
]
],
limit:
search
? 2000
: limit
});

const paidRowsAll =
paidOrders.map(
(order)=>{

const data =
order.toJSON();

return {
id:`payment-${data.id}`,
source:"payment",
orderId:data.orderId,
userId:data.userId,
publicUserId:data.user?.publicUserId,
userName:getDisplayName(
data.user
),
phone:data.user?.phone || "—",
gender:data.user?.gender || "—",
amount:Number(data.amount) || 0,
coins:Number(data.coins) || 0,
status:data.status,
paymentMethod:data.paymentMethod || "Cashfree",
paymentId:data.cashfreePaymentId || "—",
createdAt:data.createdAt,
paidAt:data.updatedAt
};

}
);

const paidRows =
search
? paidRowsAll.filter(
(row)=>
{
const values =
[
row.orderId,
row.userId,
row.publicUserId,
row.userName,
row.phone,
row.paymentMethod,
row.paymentId,
row.status,
row.amount,
row.coins,
row.paidAt
]
.filter(Boolean)
.map(
(value)=>
String(value).toLowerCase()
);

return values.some(
(value)=>{

const compactValue =
value.replace(
/[^a-z0-9]/g,
""
);

return (
value.includes(search) ||
(
compactSearch &&
compactValue.includes(compactSearch)
)
);

}
);

}
)
: paidRowsAll;

const rows =
[
...paidRows
]
.sort(
(a,b)=>
new Date(b.paidAt).getTime() -
new Date(a.paidAt).getTime()
)
.slice(
0,
limit
)
.map(applyGstBreakdown);

const totalAmount =
paidRows.reduce(
(sum,row)=>
sum + row.amount,
0
);

const totalGstAmount =
paidRows.reduce(
(sum,row)=>
sum + splitInclusiveGst(row.amount, gstPercent).gstAmount,
0
);

const totalBaseRevenue =
paidRows.reduce(
(sum,row)=>
sum + splitInclusiveGst(row.amount, gstPercent).baseRevenue,
0
);

const totalCoins =
rows.reduce(
(sum,row)=>
sum + row.coins,
0
);

const todayStart =
new Date();

todayStart.setHours(
0,
0,
0,
0
);

const todayEnd =
new Date(
todayStart
);

todayEnd.setDate(
todayEnd.getDate() + 1
);

const todayAmount =
paidRows
.filter(
(row)=>
{
const paidAt =
new Date(
row.paidAt
);

return (
paidAt >= todayStart &&
paidAt < todayEnd
);
}
)
.reduce(
(sum,row)=>
sum + row.amount,
0
);

const todayGstAmount =
paidRows
.filter(
(row)=>
{
const paidAt =
new Date(
row.paidAt
);

return (
paidAt >= todayStart &&
paidAt < todayEnd
);
}
)
.reduce(
(sum,row)=>
sum + splitInclusiveGst(row.amount, gstPercent).gstAmount,
0
);

const todayBaseRevenue =
todayAmount - todayGstAmount;

return res.json({
summary:{
totalAmount,
todayAmount,
totalCoins,
totalRecharges:rows.length,
paidOrders:paidRows.length,
legacyWalletRecharges:0,
gstPercent,
totalGstAmount:Math.round((totalGstAmount + Number.EPSILON) * 100) / 100,
totalBaseRevenue:Math.round((totalBaseRevenue + Number.EPSILON) * 100) / 100,
todayGstAmount:Math.round((todayGstAmount + Number.EPSILON) * 100) / 100,
todayBaseRevenue:Math.round((todayBaseRevenue + Number.EPSILON) * 100) / 100,
},
rows
});

}catch(error){

console.log(
"ADMIN RECHARGE REVENUE ERROR",
error
);

return res
.status(500)
.json({
message:error.message
});

}

};

// ===================================
// USER DETAILS
// ===================================


export const getUserDetails =
async(
req,
res
)=>{


try{


const user =
await User.findByPk(

req.params.id,

{

include:[

{
model:Wallet
}

]

}

);




if(!user){


return res.status(404)
.json({

message:"User not found"

});


}




res.json(

user

);



}catch(error){



res.status(500)
.json({

message:error.message

});


}


};

// ===================================
// BLOCK USER
// ===================================


export const blockUser =
async(
req,
res
)=>{


try{


await ensureBlockedColumn();


const user =
await User.findByPk(
req.params.id
);




if(!user){


return res.status(404)
.json({

message:"User not found"

});


}




const [
result
]=
await sequelize.query(
"SELECT COALESCE(blocked, 0) AS blocked FROM users WHERE id = :id",

{
replacements:{
id:req.params.id
},
type:sequelize.QueryTypes.SELECT
}

);


const currentBlocked =
Boolean(
result?.blocked
);


const nextBlocked =
!currentBlocked;


await sequelize.query(
"UPDATE users SET blocked = :blocked WHERE id = :id",

{
replacements:{
blocked:nextBlocked ? 1 : 0,
id:req.params.id
}
}

);




res.json({


success:true,


blocked:nextBlocked


});




}catch(error){


res.status(500)
.json({

message:error.message

});


}



};



// ===================================
// DELETE USER
// ===================================


export const deleteUser =
async(
req,
res
)=>{

const userId =
req.params.id;

const transaction =
await sequelize.transaction();

try{

const user =
await User.findByPk(
userId,
{
transaction
}
);

if(
!user
){

await transaction.rollback();

return res
.status(404)
.json({
message:"User not found"
});

}

const callRows =
await CallHistory.findAll({
where:{
[Op.or]:[
{ callerId:userId },
{ receiverId:userId }
]
},
attributes:[
"id"
],
transaction
});

const callIds =
callRows.map(
(row)=>row.id
);

if(
callIds.length
){

await Earning.destroy({
where:{
callId:{
[Op.in]:callIds
}
},
transaction
});

await CallRating.destroy({
where:{
[Op.or]:[
{
callHistoryId:{
[Op.in]:callIds
}
},
{ callerId:userId },
{ femaleId:userId }
]
},
transaction
});

}

await Promise.all([
WalletTransaction.destroy({
where:{ userId },
transaction
}),
PaymentOrder.destroy({
where:{ userId },
transaction
}),
Wallet.destroy({
where:{ userId },
transaction
}),
Favorite.destroy({
where:{
[Op.or]:[
{ userId },
{ favoriteUserId:userId }
]
},
transaction
}),
Earning.destroy({
where:{ userId },
transaction
}),
Withdraw.destroy({
where:{ userId },
transaction
}),
Kyc.destroy({
where:{ userId },
transaction
}),
DeviceToken.destroy({
where:{ userId },
transaction
}),
NotificationRecord.destroy({
where:{ userId },
transaction
}),
ChatMessage.destroy({
where:{
[Op.or]:[
{ senderId:userId },
{ receiverId:userId }
]
},
transaction
}),
CallGiftRecord.destroy({
where:{
[Op.or]:[
{ senderId:userId },
{ receiverId:userId }
]
},
transaction
}),
Block.destroy({
where:{
[Op.or]:[
{ blockerId:userId },
{ blockedUserId:userId }
]
},
transaction
}),
AccountDeletionRequest.destroy({
where:{ userId },
transaction
})
]);

const tickets =
await SupportTicket.findAll({
where:{ userId },
attributes:[
"id"
],
transaction
});

const ticketIds =
tickets.map(
(ticket)=>ticket.id
);

if(
ticketIds.length
){

await SupportMessage.destroy({
where:{
ticketId:{
[Op.in]:ticketIds
}
},
transaction
});

await SupportTicket.destroy({
where:{ userId },
transaction
});

}

await CallHistory.destroy({
where:{
[Op.or]:[
{ callerId:userId },
{ receiverId:userId }
]
},
transaction
});

await user.destroy({
transaction
});

await transaction.commit();

return res.json({
success:true,
message:"User deleted"
});

}catch(error){

await transaction.rollback();

return res
.status(500)
.json({
message:error.message
});

}

};





// ===================================
// STREAM VERIFICATION MEDIA
// ===================================

const resolveVerificationUploadPath = (mediaUrl) => {
  if (!mediaUrl || typeof mediaUrl !== "string") {
    return null;
  }

  const cleaned = mediaUrl.split("?")[0].split("#")[0];

  if (!cleaned.startsWith("/uploads/verification-")) {
    return null;
  }

  const uploadsRoot = path.resolve(
    path.join(__dirname, "../../uploads")
  );

  const absolutePath = path.resolve(
    path.join(__dirname, "../..", cleaned.replace(/^\//, ""))
  );

  if (
    absolutePath !== uploadsRoot &&
    !absolutePath.startsWith(`${uploadsRoot}${path.sep}`)
  ) {
    return null;
  }

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return absolutePath;
};

export const streamUserVerificationMedia =
async (
req,
res
) => {
  try {
    const kind = String(req.params.kind || "").toLowerCase();

    if (kind !== "video" && kind !== "audio") {
      return res.status(400).json({
        message: "Invalid media kind. Use video or audio.",
      });
    }

    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const mediaUrl =
      kind === "video"
        ? user.verificationVideoUrl
        : user.verificationAudioUrl;

    const filePath = resolveVerificationUploadPath(mediaUrl);

    if (!filePath) {
      return res.status(404).json({
        message: `Verification ${kind} not found`,
      });
    }

    return res.sendFile(filePath);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// ===================================
// VERIFY USER
// ===================================


export const verifyUser =
async(
req,
res
)=>{


try{


await ensureAccountStatusColumn();


const user =
await User.findByPk(

req.params.id

);




if(!user){


return res.status(404)
.json({

message:"User not found"

});


}




if(
user.gender !== "Female"
){


return res.status(400)
.json({

message:"Approve/Reject is only available for female users"

});


}




const action =
req.body?.action;


let accountStatus =
null;


if(
action === "approve"
){


accountStatus =
"approved";


}
else if(
action === "reject"
){


accountStatus =
"rejected";


}
else{


return res.status(400)
.json({

message:"Invalid action. Use approve or reject."

});


}




let rejectionReasonsPayload =
null;

if(accountStatus === "rejected"){
const rawReasons =
req.body?.rejectionReasons ??
req.body?.reasons ??
[];

const rejectionReasons =
parseRejectionReasons(
rawReasons
);

if(rejectionReasons.length === 0){
return res.status(400).json({
message:"Select at least one rejection reason"
});
}

rejectionReasonsPayload =
JSON.stringify(rejectionReasons);
}

await sequelize.query(
`UPDATE users
SET accountStatus = :accountStatus,
verified = :verified,
rejectionReasons = :rejectionReasons
WHERE id = :id`,

{
replacements:{

accountStatus,

verified:accountStatus === "approved" ? 1 : 0,

rejectionReasons:
accountStatus === "approved"
? null
: rejectionReasonsPayload,

id:req.params.id

}

}

);

if(accountStatus === "approved"){
await notifyFemaleAccountApproved(
req.params.id
);
}

res.json({


success:true,

accountStatus,

rejectionReasons:
accountStatus === "rejected"
? parseRejectionReasons(rejectionReasonsPayload)
: [],

message:accountStatus === "approved" ? "User approved" : "User rejected"


});




}catch(error){


res.status(500)
.json({

message:error.message

});


}



};





// ===================================
// GET ALL KYC REQUESTS
// ===================================


export const kycRequests =
async(
req,
res
)=>{


try{


const data =
await Kyc.findAll({


include:[

{
model:User
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
data
);



}catch(error){


res.status(500)
.json({

message:error.message

});


}


};









// ===================================
// APPROVE KYC
// ===================================


export const approveKyc =
async(
req,
res
)=>{


try{


const kyc =
await Kyc.findByPk(

req.params.id

);



if(!kyc){


return res.status(404)
.json({

message:"KYC not found"

});

}





await kyc.update({

status:"approved"

});





await User.update(

{

verified:true

},

{

where:{

id:kyc.userId

}

}

);


await notifyKycApproved(
kyc.userId
);


res.json({

success:true,

message:"KYC approved"

});




}catch(error){



res.status(500)
.json({

message:error.message

});



}


};









// ===================================
// REJECT KYC
// ===================================


export const rejectKyc =
async(
req,
res
)=>{


try{


const kyc =
await Kyc.findByPk(

req.params.id

);



if(!kyc){


return res.status(404)
.json({

message:"KYC not found"

});

}





await kyc.update({


status:"rejected",


reason:
req.body.reason


});






res.json({

success:true

});



}catch(error){


res.status(500)
.json({

message:error.message

});


}



};