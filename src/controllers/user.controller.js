import {
    User,
    Wallet,
    CallHistory,
    Favorite,
  } from "../models/index.js";

import {
notifyMalesWhenFemaleOnline
} from "../services/notificationPush.service.js";

import {
getFemaleRatingStatsMap
} from "../services/ratingStats.service.js";

import {
filterBlockedUsers,
getBlockedPeerIds
} from "../services/block.service.js";
import {
getPublicCallRates,
attachCreatorCallRates,
} from "../services/callRate.service.js";
import {
getAppSettings,
languagesOverlap,
parseLanguages
} from "../services/appSettings.service.js";
import {
buildVerificationAudioUrl,
buildVerificationVideoUrl
} from "../services/verificationUpload.service.js";
import {
ensureUserSchema
} from "../services/userSchema.service.js";
import {
logUserCameOnline
} from "../services/userOnlineLog.service.js";
import {
resolveMaleAvatarForProfile,
} from "../services/maleAvatar.service.js";
import {
isFallbackOtp,
verifyMsg91AccessToken,
} from "../services/msg91.service.js";
import { GROWTH_EVENT_NAMES } from "../constants/growthEventDefinitions.js";
import { trackGrowthEventAsync } from "../services/growthEvents.service.js";

const ensureVerificationAudioColumns =
ensureUserSchema;
  
  
  export const getProfile = async (req, res) => {
  
    try {
  
  
      const user =
        await User.findByPk(
          req.user.id,
          {
            attributes: {
              exclude: ["password"],
            },
          }
        );
  
  
      const wallet =
        await Wallet.findOne({
          where:{
            userId:req.user.id
          }
        });
  
  
      const calls =
        await CallHistory.count({
          where:{
            userId:req.user.id
          }
        });
  
  
      const favorites =
        await Favorite.count({
          where:{
            userId:req.user.id
          }
        });
  
  
      res.json({
  
        user,
  
        stats:{
  
          calls,
  
          favorites,
  
          gold:
            wallet?.balance || 0
  
        }
  
      });
  
  
    } catch(error){
  
      res.status(500).json({
        message:error.message
      });
  
    }
  
  };
  
  
  export const updateProfile = async (req,res)=>{


    try{
    
    
    const {
    
     userId,
    
     nickname,
    
     bio,
    
     avatar,
    
     gender,
    
     age,
    
     preferredAge,
    
     languages,
    
     interests,
    
     verificationType,
    
     audioVerified,
    
     videoVerified,

     verificationAudioUrl,

     verificationSentence,

     verificationVideoUrl
    
    }=req.body;
    
    
    
    
    if(!userId){
    
    
    return res.status(400).json({
    
     message:"userId required"
    
    });
    
    
    }
    
    
    
    
    const user =
    await User.findByPk(
     userId
    );
    
    
    
    
    if(!user){
    
    
    return res.status(404).json({
    
     message:"User not found"
    
    });
    
    
    }

    const normalizedLanguages =
      languages !== undefined
        ? parseLanguages(languages)
        : parseLanguages(user.languages);

    const resolvedGender =
      gender ?? user.gender;

    if (
      resolvedGender === "Male" &&
      normalizedLanguages.length === 0
    ) {
      return res.status(400).json({
        message: "At least one language is required",
      });
    }

    const resolvedAge =
      age !== undefined && age !== null
        ? Number(age)
        : Number(user.age);

    if (
      resolvedGender === "Male" &&
      (!Number.isFinite(resolvedAge) || resolvedAge < 18)
    ) {
      return res.status(400).json({
        message: "You must be 18 years or older to register",
      });
    }

    const resolvedAvatar = resolveMaleAvatarForProfile({
      avatar,
      gender: resolvedGender,
    });
    
    
    const wasProfileCompleted = Boolean(user.profileCompleted);
    
    
    await user.update({


      username:
      nickname,
     
     
      bio,
     
     
      avatar: resolvedAvatar,
     
     
      gender,
     
     
      age,
     
     
      preferredAge,
     
     
      languages: normalizedLanguages,
     
     
      interests,
     
     
      verificationType,
     
     
      audioVerified,
     
     
      videoVerified,

      verificationAudioUrl:
      verificationAudioUrl ??
      user.verificationAudioUrl,

      verificationSentence:
      verificationSentence ??
      user.verificationSentence,

      verificationVideoUrl:
      verificationVideoUrl ??
      user.verificationVideoUrl,
     
     
      verified:
      audioVerified || videoVerified,

      accountStatus:
      gender === "Female" &&
      (audioVerified || videoVerified)
        ? "pending"
        : user.accountStatus,

      rejectionReasons:
      gender === "Female" &&
      (audioVerified || videoVerified)
        ? null
        : user.rejectionReasons,
     
     
      profileCompleted:true
     
     
     });
    
    if (!wasProfileCompleted) {
      trackGrowthEventAsync({
        eventName: GROWTH_EVENT_NAMES.PROFILE_COMPLETED,
        userId: user.id,
        metadata: {
          gender: user.gender,
        },
      });
    }
    
    
    
    return res.json({
    
    
    message:
    "Profile updated successfully",
    
    
    user
    
    
    });
    
    
    
    
    }catch(error){
    
    
    console.log(
    "PROFILE ERROR",
    error
    );
    
    
    return res.status(500).json({
    
    message:
    error.message
    
    });
    
    
    }
    
    
    };

    export const getUsers = async(req,res)=>{


      try{

      const {
      gender,
      userId,
      onlineOnly,
      shuffle
      }=req.query;

      const isFemaleQuery =
      String(gender ?? "")
      .toLowerCase() === "female";

      const where={
       verified:true
      };

      if(gender){
       where.gender=
       isFemaleQuery
       ?
       "Female"
       :
       String(gender).toLowerCase() === "male"
       ?
       "Male"
       :
       gender;
      }

      if(isFemaleQuery){
       where.accountStatus = "approved";

       if(
       onlineOnly === "1" ||
       onlineOnly === "true"
       ){
        where.online = true;
       } else if(
       onlineOnly === "0" ||
       onlineOnly === "false"
       ){
        where.online = false;
       }
      }
      
      
      const users =
      await User.findAll({
      
       attributes:[
        "id",
        "username",
        "name",
        "bio",
        "avatar",
        "gender",
        "age",
        "languages",
        "interests",
        "verified",
        "online",
        "accountStatus",
        "acceptVoiceCalls",
        "acceptVideoCalls",
        "createdAt"
       ],
      
       where,
      
       order:[
        ["createdAt","DESC"]
       ]
      
      });

      const ratingMap =
      await getFemaleRatingStatsMap();

      const callRates =
      await getPublicCallRates();

      const usersWithRates =
      await attachCreatorCallRates(users);

      let formattedUsers =
      usersWithRates.map(
      (data)=>{
      const stats =
      ratingMap.get(Number(data.id))
      ??
      {
       ratingScore:0,
       ratingCount:0
      };

      const isFemale =
      String(data.gender ?? "")
      .toLowerCase() === "female";

      return {
       ...data,
       ...stats,
       status:
       data.online
       ?
       "online"
       :
       "offline",
       voiceRatePerMinute:
       isFemale
       ?
       data.voiceRatePerMinute
       :
       undefined,
       videoRatePerMinute:
       isFemale
       ?
       data.videoRatePerMinute
       :
       undefined
      };
      }
      );

      if(
      shuffle === "1" ||
      shuffle === "true"
      ){
       formattedUsers =
       [...formattedUsers].sort(
       ()=>Math.random() - 0.5
       );
      }

      if(userId){
       const blockedIds =
       await getBlockedPeerIds(userId);

       formattedUsers =
       filterBlockedUsers(
       formattedUsers,
       blockedIds
       );
      }

      const appSettings =
      await getAppSettings();

      if(
      isFemaleQuery &&
      appSettings.languageMatchingEnabled &&
      userId
      ){
       const requester =
       await User.findByPk(
       userId,
       {
        attributes:[
         "id",
         "gender",
         "languages"
        ]
       }
       );

       const requesterLanguages =
       parseLanguages(
       requester?.languages
       );

       if(requesterLanguages.length > 0){
        formattedUsers =
        formattedUsers.filter(
        (candidate)=>
        languagesOverlap(
        requesterLanguages,
        candidate.languages
        )
        );
       }
      }

      const page =
      Math.max(
      1,
      parseInt(req.query.page,10) || 1
      );

      const limit =
      Math.min(
      50,
      Math.max(
      1,
      parseInt(req.query.limit,10) || 10
      )
      );

      const usePagination =
      req.query.page !== undefined ||
      req.query.limit !== undefined;

      if(usePagination){

      const total =
      formattedUsers.length;

      const offset =
      (page - 1) * limit;

      const paginatedUsers =
      formattedUsers.slice(
      offset,
      offset + limit
      );

      return res.json({
       users:paginatedUsers,
       total,
       page,
       limit,
       hasMore:
       offset + paginatedUsers.length < total,
       callRates,
       languageMatchingEnabled:
       appSettings.languageMatchingEnabled
      });
      }
      
      
      
      return res.json({
      
       users:formattedUsers,
       callRates
      
      });
      
      
      
      }catch(error){
      
      
      console.log(
      "GET USERS ERROR",
      error
      );
      
      
      return res.status(500).json({
      
       message:error.message
      
      });
      
      
      }
      
      
      };



// =====================
// UPDATE ONLINE STATUS
// =====================


export const updateOnlineStatus =
async(req,res)=>{


try{

await ensureUserSchema();

const {
 userId,
 online,
 status,
 notifyFavorites
}=req.body;




const user =
await User.findByPk(
userId
);



if(!user){


return res.status(404).json({

message:"User not found"

});


}




const wantsOnline =
typeof online === "boolean"
?
online
:
status === "online";

const accountStatus =
user.accountStatus ||
(
user.gender === "Female"
? "pending"
: "active"
);

if(
user.gender === "Female" &&
wantsOnline &&
accountStatus !== "approved"
){
return res.status(403).json({
message:
accountStatus === "rejected"
? "Your account was rejected by admin"
: "Your account is waiting for admin approval",
accountStatus
});
}




const wasOnline =
Boolean(user.online);

const isOnline =
wantsOnline;




await user.update({

online:isOnline

});

if(
isOnline &&
!wasOnline
){
try{
await logUserCameOnline(user);
}catch(logError){
console.log(
"ONLINE LOG ERROR",
logError.message
);
}
}




const wantsFavoriteNotify =
notifyFavorites === true ||
notifyFavorites === "true" ||
notifyFavorites === 1 ||
notifyFavorites === "1";

// Notify males only on explicit Offline → Online (female Online switch),
// including closed-app FCM/Expo push. Skip call busy/resume and system restore.
if(
isOnline &&
!wasOnline &&
wantsFavoriteNotify
){
try{
const notifyResult =
await notifyMalesWhenFemaleOnline(
userId,
{
broadcastStatus:true,
// Real off→on toggle must always attempt push for offline males.
ignoreCooldown:true
}
);

console.log(
"STATUS FAVORITE ONLINE RESULT",
{
userId,
...notifyResult
}
);
}catch(error){
console.log(
"STATUS FAVORITE ONLINE ERROR",
error.message
);
}
}




return res.json({

message:"Status updated",

user

});




}catch(error){


return res.status(500).json({

message:error.message

});


}


};

// =====================
// UPDATE CALL PREFERENCES
// =====================

export const verifyPhoneNumber =
async(req,res)=>{

try{

await ensureUserSchema();

const {
userId,
otp,
accessToken,
adminNotifyId
}=req.body || {};

const user =
await User.findByPk(
userId
);

if(!user){
return res.status(404).json({
message:"User not found"
});
}

let verified = false;

if(isFallbackOtp(otp)){
verified = true;
}else if(accessToken){
verified =
await verifyMsg91AccessToken(
accessToken
);
}

if(!verified){
return res.status(400).json({
message:"Invalid or expired OTP"
});
}

await user.update({
phoneVerified:true
});

return res.json({
message:"Mobile number validated",
phoneVerified:true,
phone:user.phone,
adminNotifyId:
adminNotifyId ??
null
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const updateNotificationPreferences =
async(req,res)=>{

try{

await ensureUserSchema();

const {
 userId,
 notificationsEnabled
}=req.body;

const user =
await User.findByPk(
userId
);

if(!user){
return res.status(404).json({
message:"User not found"
});
}

if(
typeof notificationsEnabled !== "boolean"
){
return res.status(400).json({
message:"notificationsEnabled must be a boolean"
});
}

await user.update({
notificationsEnabled
});

return res.json({
message:"Notification preferences updated",
notificationsEnabled:Boolean(user.notificationsEnabled)
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const updateCallPreferences =
async(req,res)=>{

try{

await ensureUserSchema();

const {
 userId,
 acceptVoiceCalls,
 acceptVideoCalls,
 acceptAutoRoutedCalls,
}=req.body;

const parseOptionalBoolean = (value) => {
 if(value === undefined || value === null){
 return undefined;
 }

 if(typeof value === "boolean"){
 return value;
 }

 const normalized =
 String(value).trim().toLowerCase();

 if(normalized === "1" || normalized === "true"){
 return true;
 }

 if(normalized === "0" || normalized === "false"){
 return false;
 }

 return undefined;
};

const parsedAcceptVoiceCalls =
parseOptionalBoolean(acceptVoiceCalls);

const parsedAcceptVideoCalls =
parseOptionalBoolean(acceptVideoCalls);

const parsedAcceptAutoRoutedCalls =
parseOptionalBoolean(acceptAutoRoutedCalls);

const user =
await User.findByPk(
userId
);

if(!user){

return res.status(404).json({
message:"User not found"
});

}

if(
user.gender !== "Female"
){
return res.status(403).json({
message:"Only female users can update call preferences"
});
}

const accountStatus =
user.accountStatus ||
"pending";

if(
accountStatus !== "approved"
){
return res.status(403).json({
message:"Your account must be approved to update call preferences",
accountStatus
});
}

const nextVoice =
parsedAcceptVoiceCalls !== undefined
?
parsedAcceptVoiceCalls
:
Boolean(user.acceptVoiceCalls ?? true);

const nextVideo =
parsedAcceptVideoCalls !== undefined
?
parsedAcceptVideoCalls
:
Boolean(user.acceptVideoCalls ?? true);

const nextAutoRouted =
parsedAcceptAutoRoutedCalls !== undefined
?
parsedAcceptAutoRoutedCalls
:
Boolean(user.acceptAutoRoutedCalls ?? false);

if(
parsedAcceptVoiceCalls !== undefined ||
parsedAcceptVideoCalls !== undefined
){
if(
!nextVoice &&
!nextVideo
){
return res.status(400).json({
message:"Enable at least one call mode: voice or video"
});
}
}

await user.update({
...(parsedAcceptVoiceCalls !== undefined
?
{ acceptVoiceCalls: nextVoice }
:
{}),
...(parsedAcceptVideoCalls !== undefined
?
{ acceptVideoCalls: nextVideo }
:
{}),
...(parsedAcceptAutoRoutedCalls !== undefined
?
{ acceptAutoRoutedCalls: nextAutoRouted }
:
{}),
});

await user.reload();

return res.json({
message:"Call preferences updated",
acceptVoiceCalls:Boolean(user.acceptVoiceCalls),
acceptVideoCalls:Boolean(user.acceptVideoCalls),
acceptAutoRoutedCalls:Boolean(user.acceptAutoRoutedCalls),
});

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const getUserById =
async(req,res)=>{


try{


const user =
await User.findByPk(
req.params.id,
{

attributes:[

"id",

"publicUserId",

"username",

"name",

"bio",

"avatar",

"gender",

"age",

"phone",

"preferredAge",

"languages",

"interests",

"verified",

"online",

"accountStatus",

"rejectionReasons",

"acceptVoiceCalls",

"acceptVideoCalls",

"notificationsEnabled",

"createdAt"

]

}

);




if(!user){


return res.status(404).json({

message:"User not found"

});


}




const [userWithRates] =
await attachCreatorCallRates([user]);




return res.json(

userWithRates ?? user

);



}catch(error){



console.log(
"GET USER ERROR",
error
);



return res.status(500).json({

message:error.message

});



}


};


export const uploadVerificationAudio =
async(req,res)=>{

try{

await ensureVerificationAudioColumns();

const {
userId,
sentence
} = req.body;

if(!userId){
return res.status(400).json({
message:"userId required"
});
}

if(!req.file){
return res.status(400).json({
message:"Audio file required"
});
}

const user =
await User.findByPk(userId);

if(!user){
return res.status(404).json({
message:"User not found"
});
}

const verificationAudioUrl =
buildVerificationAudioUrl(
req.file.filename
);

await user.update({
verificationAudioUrl,
verificationSentence:
sentence?.trim() ||
user.verificationSentence
});

const host =
req.get("host");

const protocol =
req.protocol;

return res.json({
success:true,
verificationAudioUrl,
verificationAudioFullUrl:
`${protocol}://${host}${verificationAudioUrl}`,
user
});

}catch(error){

console.log(
"UPLOAD VERIFICATION AUDIO ERROR",
error
);

return res.status(500).json({
message:error.message
});

}

};


export const uploadVerificationVideo =
async(req,res)=>{

try{

await ensureVerificationAudioColumns();

const {
userId,
sentence
} = req.body;

if(!userId){
return res.status(400).json({
message:"userId required"
});
}

if(!req.file){
return res.status(400).json({
message:"Video file required"
});
}

const user =
await User.findByPk(userId);

if(!user){
return res.status(404).json({
message:"User not found"
});
}

const verificationVideoUrl =
buildVerificationVideoUrl(
req.file.filename
);

const updates = {
verificationVideoUrl
};

if(
typeof sentence === "string" &&
sentence.trim()
){
updates.verificationSentence =
sentence.trim();
}

await user.update(updates);

const host =
req.get("host");

const protocol =
req.protocol;

return res.json({
success:true,
verificationVideoUrl,
verificationVideoFullUrl:
`${protocol}://${host}${verificationVideoUrl}`,
user
});

}catch(error){

console.log(
"UPLOAD VERIFICATION VIDEO ERROR",
error
);

return res.status(500).json({
message:error.message
});

}

};