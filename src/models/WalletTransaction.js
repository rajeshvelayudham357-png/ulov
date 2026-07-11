import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";


export const WalletTransaction =
sequelize.define(
"wallet_transactions",
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


 type:{
  type:DataTypes.STRING
 },


 amount:{
  type:DataTypes.INTEGER
 },


 description:{
  type:DataTypes.STRING
 }


}

);