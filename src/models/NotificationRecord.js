import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const NotificationRecord =
sequelize.define(
"app_notifications",
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

title:{
 type:DataTypes.STRING,
 allowNull:false
},

message:{
 type:DataTypes.TEXT,
 allowNull:true
},

type:{
 type:DataTypes.STRING,
 defaultValue:"system"
},

data:{
 type:DataTypes.JSON,
 allowNull:true
},

read:{
 type:DataTypes.BOOLEAN,
 defaultValue:false
}
}
);
