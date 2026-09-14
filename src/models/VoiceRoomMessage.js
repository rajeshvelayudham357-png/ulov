import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const VoiceRoomMessage = sequelize.define(
  "voice_room_messages",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    roomId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    sessionId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    messageText: {
      type: DataTypes.STRING(240),
      allowNull: false,
    },
  },
  {
    indexes: [
      { fields: ["roomId", "createdAt"] },
      { fields: ["sessionId", "createdAt"] },
      { fields: ["userId"] },
    ],
  }
);
