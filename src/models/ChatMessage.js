import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const ChatMessage =
sequelize.define(
"chat_messages",
{
id:{
 type:DataTypes.BIGINT,
 autoIncrement:true,
 primaryKey:true
},

senderId:{
 type:DataTypes.BIGINT,
 allowNull:false
},

receiverId:{
 type:DataTypes.BIGINT,
 allowNull:false
},

messageKey:{
 type:DataTypes.STRING(64),
 allowNull:false
},

messageText:{
 type:DataTypes.STRING(255),
 allowNull:false
},

read:{
 type:DataTypes.BOOLEAN,
 defaultValue:false
}
},
{
 indexes:[
  {
   fields:["senderId","receiverId","createdAt"]
  },
  {
   fields:["receiverId","read","createdAt"]
  }
 ]
}
);
