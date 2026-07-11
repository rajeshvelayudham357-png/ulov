import {
    Earning,
    User
} from "../models/index.js";


import {
    Op,
    fn,
    col,
    literal
} from "sequelize";





export const leaderboard =
async(req,res)=>{


try{


const {
type="today",
gender=""
}
=
req.query;



let start =
new Date();


let end =
new Date();





if(type==="today"){


start.setHours(
0,0,0,0
);


}



else if(type==="yesterday"){


start.setDate(
start.getDate()-1
);


start.setHours(
0,0,0,0
);



end.setDate(
end.getDate()-1
);


end.setHours(
23,59,59,999
);


}



else{


start.setDate(
start.getDate()-7
);


}




const genderFilter =
String(gender).toLowerCase();

const creatorInclude = {

model:User,

as:"creator",

required:true,

attributes:[

"id",

"username",

"nickname",

"name",

"avatar",

"online",

"gender"

]

};

if(genderFilter==="female"){
creatorInclude.where = {
 gender:{
  [Op.in]:[
   "Female",
   "female",
   "FEMALE"
  ]
 }
};
}




const list =
await Earning.findAll({



attributes:[


"userId",



[
fn(
"SUM",
col("coins")
),
"totalGold"
],



[
fn(
"COUNT",
col("Earning.id")
),
"totalCalls"
]


],




where:{


createdAt:{


[Op.between]:
[
start,
end
]


}


},




include:[
creatorInclude
],




group:[

"Earning.userId",

"creator.id"

],





order:[


[
literal(
"totalGold"
),

"DESC"

]


],




limit:50



});





const data =
list.map(
(item,index)=>({


rank:index+1,


reward:
index===0
?
500
:
index===1
?
300
:
index===2
?
100
:
0,


trend:
Math.floor(
Math.random()*10
),



...item.toJSON()



})

);





return res.json({

leaderboard:data

});




}catch(error){



console.log(
"LEADERBOARD ERROR",
error
);



return res
.status(500)
.json({

message:error.message

});


}



};