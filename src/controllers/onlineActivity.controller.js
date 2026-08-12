import {
  listUserOnlineActivity,
} from "../services/userOnlineLog.service.js";

export const getUserOnlineActivity =
async(req,res)=>{

try{

const result =
await listUserOnlineActivity({

page:req.query.page,

limit:req.query.limit,

search:req.query.search,

date:req.query.date,

gender:req.query.gender,

});


return res.json(result);


}catch(error){


return res.status(500).json({
message:error.message
});


}

};
