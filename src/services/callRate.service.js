import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";
import { normalizeCallTypeForDb } from "../constants/callTypes.js";

const DEFAULT_SETTINGS = {
voiceRatePerMinute:60,
videoRatePerMinute:60,
femaleEarningPercentage:50
};

let tableReady =
false;

let creatorTableReady =
false;

const ensureCallRateTable =
async()=>{

if(tableReady){
return;
}

await sequelize.query(
`CREATE TABLE IF NOT EXISTS admin_call_rate_settings (
id TINYINT NOT NULL PRIMARY KEY,
voiceRatePerMinute FLOAT NOT NULL DEFAULT 60,
videoRatePerMinute FLOAT NOT NULL DEFAULT 60,
femaleEarningPercentage FLOAT NOT NULL DEFAULT 50,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
);

await sequelize.query(
`INSERT IGNORE INTO admin_call_rate_settings
(id, voiceRatePerMinute, videoRatePerMinute, femaleEarningPercentage)
VALUES (1, :voiceRatePerMinute, :videoRatePerMinute, :femaleEarningPercentage)`,
{
replacements:DEFAULT_SETTINGS
}
);

tableReady =
true;

};

const ensureCreatorCallRateTable =
async()=>{

if(creatorTableReady){
return;
}

await sequelize.query(
`CREATE TABLE IF NOT EXISTS creator_call_rate_settings (
userId BIGINT NOT NULL PRIMARY KEY,
femaleEarningPercentage FLOAT NOT NULL,
createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`
);

creatorTableReady =
true;

};

const toPositiveNumber =
(value,
fallback)=>
Number.isFinite(Number(value)) &&
Number(value) >= 0
? Number(value)
: fallback;

const clampPercentage =
(value,
fallback)=>
Math.min(
100,
Math.max(
0,
toPositiveNumber(
value,
fallback
)
)
);

export const getCallRateSettings =
async()=>{

await ensureCallRateTable();

const rows =
await sequelize.query(
"SELECT * FROM admin_call_rate_settings WHERE id = 1 LIMIT 1",
{
type:QueryTypes.SELECT
}
);

const row =
rows[0] ||
DEFAULT_SETTINGS;

return {
voiceRatePerMinute:Number(row.voiceRatePerMinute) || DEFAULT_SETTINGS.voiceRatePerMinute,
videoRatePerMinute:Number(row.videoRatePerMinute) || DEFAULT_SETTINGS.videoRatePerMinute,
femaleEarningPercentage:Number(row.femaleEarningPercentage) || DEFAULT_SETTINGS.femaleEarningPercentage,
updatedAt:row.updatedAt || null
};

};

export const getCreatorEarningPercentage =
async(
creatorId,
fallbackPercentage
)=>{

await ensureCreatorCallRateTable();

if(!creatorId){
return fallbackPercentage;
}

const rows =
await sequelize.query(
"SELECT femaleEarningPercentage FROM creator_call_rate_settings WHERE userId = :creatorId LIMIT 1",
{
replacements:{
creatorId
},
type:QueryTypes.SELECT
}
);

if(!rows[0]){
return fallbackPercentage;
}

return clampPercentage(
rows[0].femaleEarningPercentage,
fallbackPercentage
);

};

export const getCreatorCallRateSettings =
async()=>{

await ensureCreatorCallRateTable();

const globalSettings =
await getCallRateSettings();

const rows =
await sequelize.query(
`SELECT
users.id,
users.publicUserId,
users.name,
users.nickname,
users.username,
users.phone,
users.avatar,
users.online,
creator_call_rate_settings.femaleEarningPercentage AS customFemaleEarningPercentage,
creator_call_rate_settings.updatedAt AS customUpdatedAt
FROM users
LEFT JOIN creator_call_rate_settings
ON creator_call_rate_settings.userId = users.id
WHERE users.gender = 'Female'
ORDER BY users.createdAt DESC`,
{
type:QueryTypes.SELECT
}
);

return rows.map(
(row)=>{

const customPercentage =
row.customFemaleEarningPercentage === null ||
row.customFemaleEarningPercentage === undefined
? null
: Number(row.customFemaleEarningPercentage);

const effectivePercentage =
customPercentage === null
? globalSettings.femaleEarningPercentage
: clampPercentage(
customPercentage,
globalSettings.femaleEarningPercentage
);

return {
id:row.id,
publicUserId:row.publicUserId,
name:
row.nickname ||
(
row.name &&
row.name !== "New User"
? row.name
: null
) ||
row.username ||
row.phone ||
"Unknown",
phone:row.phone,
avatar:row.avatar,
online:Boolean(row.online),
voiceRatePerMinute:globalSettings.voiceRatePerMinute,
videoRatePerMinute:globalSettings.videoRatePerMinute,
globalFemaleEarningPercentage:globalSettings.femaleEarningPercentage,
customFemaleEarningPercentage:customPercentage,
effectiveFemaleEarningPercentage:effectivePercentage,
usesCustomPercentage:customPercentage !== null,
updatedAt:row.customUpdatedAt || null
};

}
);

};

export const updateCreatorEarningPercentage =
async(
creatorId,
percentage
)=>{

await ensureCreatorCallRateTable();

const value =
clampPercentage(
percentage,
0
);

await sequelize.query(
`INSERT INTO creator_call_rate_settings
(userId, femaleEarningPercentage)
VALUES (:creatorId, :percentage)
ON DUPLICATE KEY UPDATE
femaleEarningPercentage = VALUES(femaleEarningPercentage),
updatedAt = NOW()`,
{
replacements:{
creatorId,
percentage:value
}
}
);

return {
userId:creatorId,
femaleEarningPercentage:value
};

};

export const updateCallRateSettings =
async(settings)=>{

await ensureCallRateTable();

const current =
await getCallRateSettings();

const next = {
voiceRatePerMinute:toPositiveNumber(
settings.voiceRatePerMinute,
current.voiceRatePerMinute
),
videoRatePerMinute:toPositiveNumber(
settings.videoRatePerMinute,
current.videoRatePerMinute
),
femaleEarningPercentage:clampPercentage(
settings.femaleEarningPercentage,
current.femaleEarningPercentage
)
};

await sequelize.query(
`UPDATE admin_call_rate_settings
SET voiceRatePerMinute = :voiceRatePerMinute,
videoRatePerMinute = :videoRatePerMinute,
femaleEarningPercentage = :femaleEarningPercentage,
updatedAt = NOW()
WHERE id = 1`,
{
replacements:next
}
);

return getCallRateSettings();

};

export const calculateCallBilling =
async({
duration,
type,
receiverId
})=>{

const settings =
await getCallRateSettings();

const durationSeconds =
Math.max(
0,
Number(duration) || 0
);

const normalizedType =
normalizeCallTypeForDb(type);

const ratePerMinute =
normalizedType === "voice"
? settings.voiceRatePerMinute
: settings.videoRatePerMinute;

const VIDEO_FIRST_HALF_SECONDS = 30;

let minutes = 0;
let maleCost = 0;

if(durationSeconds <= 0){
 minutes = 0;
 maleCost = 0;
}else if(
normalizedType === "video" &&
durationSeconds <= VIDEO_FIRST_HALF_SECONDS
){
 // First 30 billable seconds of video: half the per-minute rate.
 minutes = 0.5;
 maleCost =
 Math.max(
 1,
 Math.ceil(ratePerMinute / 2)
 );
}else{
 // Face-gated video can end with 0 billable seconds — do not force a 1-minute minimum above.
 minutes =
 Math.max(
 1,
 Math.ceil(
 durationSeconds / 60
 )
 );
 maleCost =
 Math.ceil(
 minutes * ratePerMinute
 );
}

const creatorPercentage =
await getCreatorEarningPercentage(
receiverId,
settings.femaleEarningPercentage
);

const femaleEarn =
Math.floor(
maleCost *
creatorPercentage /
100
);

return {
settings,
minutes,
type:normalizedType,
ratePerMinute,
femaleEarningPercentage:creatorPercentage,
maleCost,
femaleEarn,
femaleAmount:femaleEarn / 2
};

};

export const getPublicCallRates =
async()=>{

const settings =
await getCallRateSettings();

return {
voiceRatePerMinute:settings.voiceRatePerMinute,
videoRatePerMinute:settings.videoRatePerMinute,
femaleEarningPercentage:settings.femaleEarningPercentage,
updatedAt:settings.updatedAt
};

};

export const getCreatorCallRateSummary =
async(
creatorId
)=>{

await ensureCreatorCallRateTable();

const settings =
await getCallRateSettings();

const femaleEarningPercentage =
await getCreatorEarningPercentage(
creatorId,
settings.femaleEarningPercentage
);

const customRows =
creatorId
?
await sequelize.query(
"SELECT femaleEarningPercentage FROM creator_call_rate_settings WHERE userId = :creatorId LIMIT 1",
{
replacements:{
creatorId
},
type:QueryTypes.SELECT
}
)
:
[];

const usesCustomPercentage =
customRows.length > 0;

const voiceEarnPerMinute =
Math.floor(
settings.voiceRatePerMinute *
femaleEarningPercentage /
100
);

const videoEarnPerMinute =
Math.floor(
settings.videoRatePerMinute *
femaleEarningPercentage /
100
);

return {
voiceRatePerMinute:settings.voiceRatePerMinute,
videoRatePerMinute:settings.videoRatePerMinute,
globalFemaleEarningPercentage:settings.femaleEarningPercentage,
femaleEarningPercentage,
usesCustomPercentage,
voiceEarnPerMinute,
videoEarnPerMinute,
updatedAt:settings.updatedAt
};

};
