import {
    DataTypes
  } from "sequelize";
  
  import { sequelize } from "../config/database.js";
  
  
  const Otp = sequelize.define(
    "Otp",
    {
  
      phone:{
        type:DataTypes.STRING,
        allowNull:false,
      },
  
      otp:{
        type:DataTypes.STRING,
        allowNull:false,
      },
  
      expiresAt:{
        type:DataTypes.DATE,
        allowNull:false,
      }
  
    }
  );
  
  
  export default Otp;