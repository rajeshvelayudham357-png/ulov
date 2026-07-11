import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
   
   
   
   export const SupportTicket =
   sequelize.define(
   "support_tickets",
   {
   
   id:{
   type:DataTypes.INTEGER,
   autoIncrement:true,
   primaryKey:true
   },
   
   
   userId:{
   type:DataTypes.INTEGER,
   allowNull:false
   },
   
   
   subject:{
   type:DataTypes.STRING,
   allowNull:false
   },
   
   
   message:{
   type:DataTypes.TEXT,
   allowNull:false
   },
   
   
   reply:{
   type:DataTypes.TEXT,
   allowNull:true
   },
   
   
   status:{
   type:DataTypes.ENUM(
   "open",
   "answered",
   "closed"
   ),
   
   defaultValue:"open"
   }
   
   
   }
   );