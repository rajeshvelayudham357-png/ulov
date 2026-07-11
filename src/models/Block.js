import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const Block =
sequelize.define(
"blocks",
{
id:{
 type:DataTypes.BIGINT,
 autoIncrement:true,
 primaryKey:true
},

blockerId:{
 type:DataTypes.BIGINT,
 allowNull:false
},

blockedUserId:{
 type:DataTypes.BIGINT,
 allowNull:false
},

reasonKey:{
 type:DataTypes.STRING(64),
 allowNull:false
},

reasonText:{
 type:DataTypes.STRING(255),
 allowNull:false
}
},
{
 indexes:[
  {
   unique:true,
   fields:["blockerId","blockedUserId"]
  },
  {
   fields:["blockerId","createdAt"]
  },
  {
   fields:["blockedUserId"]
  }
 ]
}
);
