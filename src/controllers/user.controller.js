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
getFemaleRatingStatsMap,
sortUsersByRating
} from "../services/ratingStats.service.js";

import {
filterBlockedUsers,
getBlockedPeerIds
} from "../services/block.service.js";
  
  
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
    
     videoVerified
    
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
    
    
    
    
    await user.update({


      username:
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
     
     
      verified:
      audioVerified || videoVerified,
     
     
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
      userId
      }=req.query;

      const where={
       verified:true
      };

      if(gender){
       where.gender=
       String(gender).toLowerCase() === "female"
       ?
       "Female"
       :
       String(gender).toLowerCase() === "male"
       ?
       "Male"
       :
       gender;
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
        "createdAt"
       ],
      
       where,
      
       order:[
        ["createdAt","DESC"]
       ]
      
      });

      const ratingMap =
      await getFemaleRatingStatsMap();

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

      return {
       ...data,
       ...stats
      };
      }
      );

      const shouldSortByRating =
      !gender ||
      String(gender).toLowerCase() === "female";

      if(shouldSortByRating){
       formattedUsers =
       sortUsersByRating(formattedUsers);
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
       offset + paginatedUsers.length < total
      });
      }
      
      
      
      return res.json({
      
       users:formattedUsers
      
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




const wasOnline =
Boolean(user.online);

const isOnline =
typeof online === "boolean"
?
online
:
status === "online";




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

export const getUserById =
async(req,res)=>{


try{


const user =
await User.findByPk(
req.params.id,
{

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