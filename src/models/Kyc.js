import {
    DataTypes
  } from "sequelize";
  
  import { sequelize } from "../config/database.js";
  
   
   const Kyc =
   sequelize.define(
   "Kyc",
   {
   
   
   userId:{
   
   type:DataTypes.INTEGER,
   allowNull:false
   
   },
   
   
   
   accountName:{
   
   type:DataTypes.STRING,
   allowNull:false
   
   },
   
   
   
   bankName:{
   
   type:DataTypes.STRING,
   allowNull:false
   
   },
   
   
   
   accountNumber:{
   
   type:DataTypes.STRING,
   allowNull:false
   
   },
   
   
   
   ifsc:{
   
   type:DataTypes.STRING,
   allowNull:false
   
   },
   
   
   
   upiId:{
   
   type:DataTypes.STRING
   
   },
   
   
   
   status:{
   
   type:DataTypes.STRING,
   
   defaultValue:"pending"
   // pending approved rejected
   
   },
   
   
   
   rejectReason:{
   
   type:DataTypes.STRING
   
   }
   
   
   }
   );
   
   
   export default Kyc;