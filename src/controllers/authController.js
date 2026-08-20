import {
    User
  } from "../models/index.js";
import jwt from "jsonwebtoken";
import {
assignPublicUserId,
generateUniquePublicUserId
} from "../services/publicUserId.service.js";
import {
ensureUserSchema
} from "../services/userSchema.service.js";
import {
normalizeIndianPhone,
verifyMsg91AccessToken,
isFallbackOtp,
} from "../services/msg91.service.js";
import {
getAppSettings,
parseLanguages,
} from "../services/appSettings.service.js";
import {
hashPin,
isValidPin,
normalizePin,
PIN_LENGTH,
verifyPinHash,
} from "../services/pinAuth.service.js";
import { GROWTH_EVENT_NAMES } from "../constants/growthEventDefinitions.js";
import { trackGrowthEventAsync } from "../services/growthEvents.service.js";
import { extractGrowthAttribution } from "../utils/growthAttribution.util.js";
import {
assertDeviceAllowedForRegistration,
enforceDeviceRegistration,
} from "../services/deviceRegistration.service.js";

const validatePhone = (phone) => {
  const normalizedPhone = normalizeIndianPhone(phone);

  if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
    return {
      ok: false,
      message: "Enter a valid 10-digit mobile number",
    };
  }

  return {
    ok: true,
    phone: normalizedPhone,
  };
};

const rejectDeviceRegistration = (
res,
check
)=>
res.status(check.status || 400).json({
message:check.message,
code:check.code,
});

const completePhoneAuth = async (res, user) => {
  const now = new Date();

  await user.update({
    lastLoginAt: now,
    lastSeen: now,
  });

  const token = issueAuthToken(user);

  return res.json({
    token,
    user: buildAuthUserPayload(user),
  });
};

const buildAuthUserPayload = (user) => ({
  id: user.id,
  publicUserId: user.publicUserId,
  phone: user.phone,
  username: user.username,
  name: user.name,
  avatar: user.avatar,
  gender: user.gender,
  bio: user.bio,
  age: user.age,
  languages: user.languages,
  interests: user.interests,
  preferredAge: user.preferredAge,
  verificationType: user.verificationType,
  audioVerified: user.audioVerified,
  videoVerified: user.videoVerified,
  verified: user.verified,
  online: user.online,
  profileCompleted: user.profileCompleted,
  accountStatus:
    user.accountStatus ??
    (user.gender === "Female" ? "pending" : "active"),
  rejectionReasons: (() => {
    const value = user.rejectionReasons;
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item || "").trim()).filter(Boolean);
        }
      } catch {
        return value.split("|").map((item) => item.trim()).filter(Boolean);
      }
    }
    return [];
  })(),
  welcomeOfferClaimed: Boolean(user.welcomeOfferClaimed),
  notificationsEnabled: user.notificationsEnabled !== false,
  phoneVerified: Boolean(user.phoneVerified),
});

const issueAuthToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      phone: user.phone,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "30d",
    }
  );

const findOrCreateUserByPhone = async (phone) => {
  let user = await User.findOne({
    where: {
      phone,
    },
  });

  let created = false;

  if (!user) {
    user = await User.create({
      phone,
      publicUserId: await generateUniquePublicUserId(),
      username: "User" + Date.now(),
      verified: false,
      online: false,
      profileCompleted: false,
    });
    created = true;
  } else {
    await assignPublicUserId(user);
  }

  return { user, created };
};


export const getAuthConfig =
async(
req,
res
)=>{

try{

const settings =
await getAppSettings();

return res.json({
authVerificationMode:
settings.authVerificationMode || "otp",
pinLength: PIN_LENGTH,
femaleVerificationMethod:
settings.femaleVerificationMethod || "audio",
});

}catch(error){

return res.status(500).json({
message: error.message,
});

}

};


export const registerFemaleCreator =
async(
req,
res
)=>{

try{

await ensureUserSchema();

const phoneResult =
validatePhone(req.body.phone);

if(
!phoneResult.ok
){

return res.status(400).json({
message:phoneResult.message
});

}

const displayName =
String(
req.body.name ||
req.body.nickname ||
""
).trim();

const age =
Number(req.body.age);

if(
!displayName
){

return res.status(400).json({
message:"Name is required"
});

}

if(
!Number.isFinite(age) ||
age < 18
){

return res.status(400).json({
message:"You must be 18 years or older to register"
});

}

const languages =
parseLanguages(
req.body.languages
);

if(
languages.length === 0
){

return res.status(400).json({
message:"Select at least one language"
});

}

if(
languages.length > 2
){

return res.status(400).json({
message:"You can select maximum 2 languages"
});

}

const phone =
phoneResult.phone;

let user =
await User.findOne({
where:{
phone
}
});

if(
user &&
user.gender === "Male"
){

return res.status(409).json({
message:"This phone number is already registered as a male user"
});

}

const interests =
Array.isArray(req.body.interests)
? req.body.interests
.map((item)=>String(item || "").trim())
.filter(Boolean)
: String(req.body.interests || "")
.split(",")
.map((item)=>item.trim())
.filter(Boolean);

if(
interests.length > 3
){

return res.status(400).json({
message:"You can select maximum 3 interests"
});

}

const verificationType =
String(req.body.verificationType || "audio").toLowerCase() === "video"
? "video"
: "audio";

const buildUniqueUsername = async (baseName, currentUserId = null) => {
  const cleaned = String(baseName || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);

  const preferred = cleaned || `User${Date.now()}`;

  let candidate = preferred;
  let suffix = 1;

  while (true) {
    const existing = await User.findOne({
      where: {
        username: candidate,
      },
      attributes: ["id"],
    });

    if (!existing || String(existing.id) === String(currentUserId || "")) {
      return candidate;
    }

    suffix += 1;
    candidate = `${preferred}${suffix}`;
  }
};

const username = await buildUniqueUsername(
  displayName,
  user?.id
);

const isNewRegistration =
!user;

if(
isNewRegistration
){
const deviceCheck =
await assertDeviceAllowedForRegistration({
payload:req.body,
});

if(
!deviceCheck.ok
){
return rejectDeviceRegistration(
res,
deviceCheck
);
}
}

const payload = {
phone,
name:displayName,
nickname:displayName,
username,
gender:"Female",
age,
bio:String(req.body.bio || "").trim(),
preferredAge:String(req.body.preferredAge || "").trim(),
languages,
interests,
verificationType,
verificationSentence:String(req.body.verificationSentence || "").trim() || null,
verified:false,
audioVerified:false,
videoVerified:false,
profileCompleted:true,
accountStatus:"pending",
rejectionReasons:null,
online:false
};

if(
user
){

await assignPublicUserId(
user
);

await user.update(
payload
);

}else{

user =
await User.create({
...payload,
publicUserId:await generateUniquePublicUserId()
});

}

await enforceDeviceRegistration({
req,
userId:user.id,
isNewRegistration,
});

return res
.status(201)
.json({
success:true,
message:"Registration submitted for approval",
user:buildAuthUserPayload(user)
});

}catch(error){

console.log(
"FEMALE WEB REGISTRATION ERROR",
error
);

return res.status(500).json({
message:error.message
});

}

};


export const completeFemaleCreatorVerification =
async(
req,
res
)=>{

try{

await ensureUserSchema();

const {
userId,
phone,
verificationType
} = req.body;

if(
!userId
){

return res.status(400).json({
message:"userId required"
});

}

const phoneResult =
validatePhone(phone);

if(
!phoneResult.ok
){

return res.status(400).json({
message:phoneResult.message
});

}

const user =
await User.findOne({
where:{
id:userId,
phone:phoneResult.phone,
gender:"Female"
}
});

if(
!user
){

return res.status(404).json({
message:"Creator registration not found"
});

}

const isVideo =
String(verificationType || user.verificationType || "audio").toLowerCase() === "video";

await user.update({
verificationType:isVideo ? "video" : "audio",
audioVerified:!isVideo,
videoVerified:isVideo,
verified:true,
profileCompleted:true,
accountStatus:"pending",
rejectionReasons:null
});

return res.json({
success:true,
message:"Verification submitted for approval",
user:buildAuthUserPayload(user)
});

}catch(error){

console.log(
"FEMALE WEB VERIFICATION COMPLETE ERROR",
error
);

return res.status(500).json({
message:error.message
});

}

};


export const checkPinPhone =
async(
req,
res
)=>{

try{

await ensureUserSchema();

const settings =
await getAppSettings();

if (settings.authVerificationMode !== "pin") {
  return res.status(400).json({
    message: "OTP login is currently active",
    authVerificationMode: "otp",
  });
}

const phoneResult =
validatePhone(req.body.phone);

if (!phoneResult.ok) {
  return res.status(400).json({
    message: phoneResult.message,
  });
}

const user =
await User.findOne({
where: {
phone: phoneResult.phone,
},
attributes: [
"id",
"phone",
"loginPinHash",
],
});

return res.json({
authVerificationMode: "pin",
hasPin: Boolean(user?.loginPinHash),
exists: Boolean(user),
pinLength: PIN_LENGTH,
});

}catch(error){

return res.status(500).json({
message: error.message,
});

}

};


export const setLoginPin =
async(
req,
res
)=>{

try{

await ensureUserSchema();

const settings =
await getAppSettings();

if (settings.authVerificationMode !== "pin") {
  return res.status(400).json({
    message: "PIN login is not enabled",
  });
}

const phoneResult =
validatePhone(req.body.phone);

if (!phoneResult.ok) {
  return res.status(400).json({
    message: phoneResult.message,
  });
}

const pin =
normalizePin(req.body.pin);

const confirmPin =
normalizePin(req.body.confirmPin);

if (!isValidPin(pin)) {
  return res.status(400).json({
    message: `PIN must be ${PIN_LENGTH} digits`,
  });
}

if (pin !== confirmPin) {
  return res.status(400).json({
    message: "PIN and confirm PIN do not match",
  });
}

let user =
await User.findOne({
where: {
phone: phoneResult.phone,
},
});

if (user?.loginPinHash) {
  return res.status(400).json({
    message: "PIN already exists for this number. Please login with your PIN.",
  });
}

const isNewRegistration =
!user;

if (
isNewRegistration
) {
const deviceCheck =
await assertDeviceAllowedForRegistration({
payload:req.body,
});

if (
!deviceCheck.ok
) {
return rejectDeviceRegistration(
res,
deviceCheck
);
}
}

if (!user) {
  user = await User.create({
    phone: phoneResult.phone,
    publicUserId: await generateUniquePublicUserId(),
    username: "User" + Date.now(),
    verified: false,
    online: false,
    profileCompleted: false,
  });
} else {
  await assignPublicUserId(user);
}

user.loginPinHash =
await hashPin(pin);

await user.save();

await enforceDeviceRegistration({
req,
userId:user.id,
isNewRegistration,
});

return completePhoneAuth(res, user);

}catch(error){

console.log("SET PIN ERROR", error);

return res.status(500).json({
message: error.message,
});

}

};


export const verifyLoginPin =
async(
req,
res
)=>{

try{

await ensureUserSchema();

const settings =
await getAppSettings();

if (settings.authVerificationMode !== "pin") {
  return res.status(400).json({
    message: "PIN login is not enabled",
  });
}

const phoneResult =
validatePhone(req.body.phone);

if (!phoneResult.ok) {
  return res.status(400).json({
    message: phoneResult.message,
  });
}

const pin =
normalizePin(req.body.pin);

if (!isValidPin(pin)) {
  return res.status(400).json({
    message: `Enter your ${PIN_LENGTH}-digit PIN`,
  });
}

const user =
await User.findOne({
where: {
phone: phoneResult.phone,
},
});

if (!user?.loginPinHash) {
  return res.status(404).json({
    message: "PIN not set for this number. Please create a PIN first.",
    hasPin: false,
  });
}

if (
  user.accountStatus === "deleted" ||
  Number(user.blocked) === 1
) {
  return res.status(403).json({
    message: "This account has been deleted or disabled.",
  });
}

const pinMatches =
await verifyPinHash(
pin,
user.loginPinHash
);

if (!pinMatches) {
  return res.status(400).json({
    message: "Incorrect PIN. Please try again.",
  });
}

await assignPublicUserId(user);

return completePhoneAuth(res, user);

}catch(error){

console.log("VERIFY PIN ERROR", error);

return res.status(500).json({
message: error.message,
});

}

};
  
  
  
  // =====================
  // SEND OTP
  // =====================
  
  
  export const sendOtp =
  async (req,res)=>{
  
  
  try{
  
  
  const {
   phone
  }=req.body;

  const normalizedPhone = normalizeIndianPhone(phone);

  if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
    return res.status(400).json({
      message: "Enter a valid 10-digit mobile number",
    });
  }
  
  
  
  console.log(
  "OTP REQUEST",
  normalizedPhone
  );
  
  
  
  return res.json({
  
  message:
  "OTP sent successfully"
  
  });
  
  
  
  }catch(error){
  
  
  return res.status(500)
  .json({
  
  message:
  error.message
  
  });
  
  
  }
  
  
  };
  
  
  
  
  
  
  
  
  
  
  // =====================
  // VERIFY OTP
  // =====================
  
  
  export const verifyOtp =
  async(req,res)=>{
  
  
  try{
  
  
  await ensureUserSchema();

  const settings =
  await getAppSettings();

  if (settings.authVerificationMode === "pin") {
    return res.status(400).json({
      message: "PIN login is enabled. OTP verification is disabled.",
    });
  }

  const {
   phone,
   otp,
   accessToken,
   msg91AccessToken
  }=req.body;

  const normalizedPhone = normalizeIndianPhone(phone);

  if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
    return res.status(400).json({
      message: "Enter a valid 10-digit mobile number",
    });
  }

  const msg91Token = accessToken || msg91AccessToken;
  let verifiedWithMsg91 = false;

  if (msg91Token) {
    verifiedWithMsg91 = await verifyMsg91AccessToken(msg91Token);
  }

  if (!verifiedWithMsg91 && isFallbackOtp(otp)) {
    verifiedWithMsg91 = true;
  }

  if (!verifiedWithMsg91) {
    return res.status(400).json({
      message: msg91Token
        ? "OTP verification failed"
        : "Invalid OTP",
    });
  }

  const existingUser =
  await User.findOne({
  where:{
  phone:normalizedPhone,
  },
  });

  const isNewRegistration =
  !existingUser;

  if(
  isNewRegistration
  ){
  const deviceCheck =
  await assertDeviceAllowedForRegistration({
  payload:req.body,
  });

  if(
  !deviceCheck.ok
  ){
  return rejectDeviceRegistration(
  res,
  deviceCheck
  );
  }
  }
  
  
  const { user, created } = await findOrCreateUserByPhone(normalizedPhone);

  await enforceDeviceRegistration({
  req,
  userId:user.id,
  isNewRegistration:created,
  });

  const now = new Date();
  await user.update({
    lastLoginAt: now,
    lastSeen: now,
  });

  if (created) {
    const attribution = extractGrowthAttribution(req);
    trackGrowthEventAsync({
      eventName: GROWTH_EVENT_NAMES.REGISTRATION_COMPLETED,
      userId: user.id,
      ...attribution,
      metadata: {
        phoneVerified: true,
        authMethod: msg91Token ? "msg91" : "otp",
      },
    });
  }

  const token = issueAuthToken(user);
  
  
  return res.json({

  token,
  
  
  user: buildAuthUserPayload(user)
  
  
  });
  
  
  
  
  
  
  }catch(error){
  
  
  
  console.log(
  "VERIFY OTP ERROR",
  error
  );
  
  
  
  return res.status(500)
  .json({
  
  message:
  error.message
  
  });
  
  
  }
  
  
  
  };
