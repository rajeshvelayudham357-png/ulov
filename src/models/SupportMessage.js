import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const SupportMessage =
sequelize.define(
"support_messages",
{
id:{
type:DataTypes.BIGINT,
autoIncrement:true,
primaryKey:true
},

ticketId:{
type:DataTypes.INTEGER,
allowNull:false
},

senderType:{
type:DataTypes.ENUM("user","admin"),
allowNull:false
},

senderId:{
type:DataTypes.INTEGER,
allowNull:true
},

message:{
type:DataTypes.TEXT,
allowNull:false
}
},
{
indexes:[
{
fields:["ticketId","createdAt"]
}
]
}
);
