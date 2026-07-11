import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";


export const Earning =
sequelize.define(
"Earning",
{


id:{
type:DataTypes.INTEGER,
primaryKey:true,
autoIncrement:true
},


userId:{

type:DataTypes.INTEGER,

allowNull:false

},



callId:{

type:DataTypes.INTEGER

},



coins:{

type:DataTypes.INTEGER,

defaultValue:0

},



amount:{

type:DataTypes.FLOAT,

defaultValue:0

},



duration:{

type:DataTypes.INTEGER,

defaultValue:0

},



status:{


type:DataTypes.ENUM(
"pending",
"paid"
),


defaultValue:"pending"


}



},
{
 indexes:[
  {
   unique:true,
   fields:["callId"],
   name:"unique_earning_per_call"
  }
 ]
}

);