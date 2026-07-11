import { DataTypes } from "sequelize";
import { sequelize } from "../config/database.js";


export const Wallet = sequelize.define(
"wallets",
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

 balance:{
    type:DataTypes.INTEGER,
    defaultValue:0
 }
}
);