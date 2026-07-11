import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";


export const Favorite =
sequelize.define(
"favorites",
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


favoriteUserId:{
 type:DataTypes.BIGINT,
 allowNull:false
}


}
);