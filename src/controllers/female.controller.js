import {
    Earning,
    CallHistory,
    User
    }
    from "../models/index.js";

import { getBlockedPeerIds } from "../services/block.service.js";
import { fetchMalePurchaseRankers, fetchMaleTopSupportedCreators } from "../services/maleRankers.service.js";
    
    
    
    export const getFemaleDashboard =
    async(req,res)=>{
    
    
    try{
    
    
    const {
    userId
    }
    =
    req.params;
    
    
    
    
    const earnings =
    await Earning.sum(
    "amount",
    {
    where:{
    userId
    }
    }
    );
    
    
    
    const minutes =
    await Earning.sum(
    "duration",
    {
    where:{
    userId
    }
    }
    );
    
    
    
    
    const calls =
    await CallHistory.count(
    {
    where:{
    receiverId:userId
    }
    }
    );
    
    
    
    
    
    return res.json({
    
    earning:
    earnings || 0,
    
    
    minutes:
    minutes || 0,
    
    
    calls
    
    });
    
    
    
    
    
    }catch(error){
    
    
    return res.status(500)
    .json({
    message:error.message
    });
    
    
    }
    
    
    
    };


export const getMaleRankers =
async(req,res)=>{

try{

const {
userId
}
=
req.params;

const page =
Math.max(
1,
Number(req.query.page) || 1
);

const limit =
Math.min(
50,
Math.max(
1,
Number(req.query.limit) || 20
)
);

const female =
await User.findByPk(userId);

if(!female){

return res.status(404).json({
message:"User not found"
});

}

const blockedIds =
await getBlockedPeerIds(userId);

const data =
await fetchMalePurchaseRankers({
page,
limit,
excludeUserIds:[...blockedIds]
});

return res.json(data);

}catch(error){

return res.status(500).json({
message:error.message
});

}

};

export const getMaleProfileForFemale = async (req, res) => {
  try {
    const { maleId } = req.params;

    const male = await User.findByPk(maleId, {
      attributes: ['id', 'username', 'name', 'avatar', 'publicUserId', 'online', 'gender']
    });

    if (!male || male.gender?.toLowerCase() !== 'male') {
      return res.status(404).json({ message: "Male user not found" });
    }

    const topCreators = await fetchMaleTopSupportedCreators(male.id, 10);

    return res.json({
      user: male,
      topCreators
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};