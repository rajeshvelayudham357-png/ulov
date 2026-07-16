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
} from "../services/appSettings.service.js";
import {
hashPin,
isValidPin,
normalizePin,
PIN_LENGTH,
verifyPinHash,
} from "../services/pinAuth.service.js";

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

const completePhoneAuth = async (res, user) => {
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
  welcomeOfferClaimed: Boolean(user.welcomeOfferClaimed),
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

  if (!user) {
    user = await User.create({
      phone,
      publicUserId: await generateUniquePublicUserId(),
      username: "User" + Date.now(),
      verified: false,
      online: false,
      profileCompleted: false,
    });
  } else {
    await assignPublicUserId(user);
  }

  return user;
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
});

}catch(error){

return res.status(500).json({
message: error.message,
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
  
  
  const user = await findOrCreateUserByPhone(normalizedPhone);

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
