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
getPublicCallRates
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
resolveMaleAvatarForProfile,
} from "../services/maleAvatar.service.js";

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

    const resolvedAvatar = resolveMaleAvatarForProfile({
      avatar,
      gender: resolvedGender,
    });
    
    
    
    
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
     
     
      profileCompleted:true
     
     
     });
    
    
    
    
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

      let formattedUsers =
      users.map(
      (user)=>{
      const data =
      user.toJSON();

      const stats =
      ratingMap.get(data.id)
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
       callRates.voiceRatePerMinute
       :
       undefined,
       videoRatePerMinute:
       isFemale
       ?
       callRates.videoRatePerMinute
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
 status
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
notifyMalesWhenFemaleOnline(
userId,
{
broadcastStatus:true
}
).catch(
error=>{
console.log(
"STATUS FAVORITE ONLINE ERROR",
error.message
);
}
);
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

export const updateCallPreferences =
async(req,res)=>{

try{

await ensureUserSchema();

const {
 userId,
 acceptVoiceCalls,
 acceptVideoCalls
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
typeof acceptVoiceCalls === "boolean"
?
acceptVoiceCalls
:
Boolean(user.acceptVoiceCalls ?? true);

const nextVideo =
typeof acceptVideoCalls === "boolean"
?
acceptVideoCalls
:
Boolean(user.acceptVideoCalls ?? true);

if(!nextVoice){
return res.status(400).json({
message:"Voice calls must remain enabled"
});
}

await user.update({
acceptVoiceCalls:nextVoice,
acceptVideoCalls:nextVideo
});

return res.json({
message:"Call preferences updated",
acceptVoiceCalls:Boolean(user.acceptVoiceCalls),
acceptVideoCalls:Boolean(user.acceptVideoCalls)
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

"acceptVoiceCalls",

"acceptVideoCalls",

"createdAt"

]

}

);




if(!user){


return res.status(404).json({

message:"User not found"

});


}




return res.json(

user

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
userId
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

await user.update({
verificationVideoUrl
});

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