import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
   
   
   
   export const Broadcast =
   sequelize.define(
   "broadcasts",
   {
   
   id:{
   type:DataTypes.INTEGER,
   autoIncrement:true,
   primaryKey:true
   },
   
   
   title:{
   type:DataTypes.STRING
   },
   
   
   message:{
   type:DataTypes.TEXT
   },
   
   
   type:{
   type:DataTypes.ENUM(
   "info",
   "offer",
   "warning"
   ),
   
   defaultValue:"info"
   
   },
   
   
   active:{
   type:DataTypes.BOOLEAN,
   defaultValue:true
   }
   
   
   }
   
   );