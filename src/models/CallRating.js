import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const CallRating =
sequelize.define(
"call_ratings",
{
id:{
 type:DataTypes.BIGINT,
 autoIncrement:true,
 primaryKey:true
},

callHistoryId:{
 type:DataTypes.BIGINT,
 allowNull:true
},

callerId:{
 type:DataTypes.BIGINT,
 allowNull:false
},

femaleId:{
 type:DataTypes.BIGINT,
 allowNull:false
},

callType:{
 type:DataTypes.STRING(16),
 allowNull:false
},

rating:{
 type:DataTypes.STRING(32),
 allowNull:false
},

remarkKeys:{
 type:DataTypes.JSON,
 allowNull:false,
 defaultValue:[]
}
},
{
 indexes:[
  {
   fields:["femaleId","createdAt"]
  },
  {
   fields:["callerId","femaleId","createdAt"]
  },
  {
   unique:true,
   fields:["callerId","callHistoryId"],
   name:"unique_rating_per_call"
  }
 ]
}
);
