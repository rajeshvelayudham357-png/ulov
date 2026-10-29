import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const DeviceToken =
sequelize.define(
"device_tokens",
{
id:{
 type:DataTypes.BIGINT,
 autoIncrement:true,
 primaryKey:true
},

userId:{
 type:DataTypes.BIGINT,
 allowNull:false
},

platform:{
 type:DataTypes.STRING,
 allowNull:true
},

devicePushToken:{
 type:DataTypes.TEXT,
 allowNull:true
},

// Version 1 bundles the long ringtone and creates Android calls-v4.
incomingCallNotificationVersion:{
 type:DataTypes.INTEGER,
 allowNull:false,
 defaultValue:0
},

expoPushToken:{
 type:DataTypes.STRING,
 allowNull:true
}
},
{
 indexes:[
  {
   unique:true,
   fields:["userId","platform"]
  }
 ]
}
);
