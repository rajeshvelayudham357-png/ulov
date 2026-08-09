import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

   
   
   export const Withdraw =
   sequelize.define(
   "Withdraw",
   {
   
   
   userId:{
   
   type:DataTypes.INTEGER,
   allowNull:false
   
   },
   
   
   amount:{
   
   type:DataTypes.FLOAT,
   defaultValue:0
   
   },
   
   
   upiId:{
   
   type:DataTypes.STRING
   
   },
   
   
   accountName:{
   
   type:DataTypes.STRING
   
   },
   
   
   accountNumber:{
   
   type:DataTypes.STRING
   
   },
   
   
   ifsc:{
   
   type:DataTypes.STRING
   
   },
   
   
   status:{
   
   type:DataTypes.STRING,
   defaultValue:"pending"
   // pending, approved, rejected
   
   }
   
   
   },
   {
    tableName: "withdraws",
    freezeTableName: true,
   }
   );
   
   
