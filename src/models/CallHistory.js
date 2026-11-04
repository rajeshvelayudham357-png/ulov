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
},

// Server-side timestamps and settlement state (Phase 1 billing fixes).
acceptedAt:{
 type:DataTypes.DATE,
 allowNull:true
},

endedAt:{
 type:DataTypes.DATE,
 allowNull:true
},

settledAt:{
 type:DataTypes.DATE,
 allowNull:true
},

collectedCoins:{
 type:DataTypes.INTEGER,
 allowNull:true
},

endReason:{
 type:DataTypes.STRING(40),
 allowNull:true
},

billingMode:{
 type:DataTypes.STRING(16),
 allowNull:true
},

billingRatePerMinute:{
 type:DataTypes.DECIMAL(10,2),
 allowNull:true
},

billableSeconds:{
 type:DataTypes.INTEGER,
 allowNull:true
}


}
);