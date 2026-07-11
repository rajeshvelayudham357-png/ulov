import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";


export const CallHistory =
sequelize.define(
"call_histories",
{

id:{
 type:DataTypes.BIGINT,
 autoIncrement:true,
 primaryKey:true
},


callerId:{
 type:DataTypes.BIGINT,
 allowNull:false
},


receiverId:{
 type:DataTypes.BIGINT,
 allowNull:false
},


type:{
 type:DataTypes.STRING
},


duration:{
 type:DataTypes.INTEGER,
 defaultValue:0
},


coinsSpent:{
 type:DataTypes.INTEGER,
 defaultValue:0
},


status:{
 type:DataTypes.STRING,
 defaultValue:"completed"
}


}
);