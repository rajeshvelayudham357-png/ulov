import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const VoiceRoomGiftRecord = sequelize.define(
  "voice_room_gift_records",
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
    senderId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    receiverId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    giftId: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    giftTitle: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    giftEmoji: {
      type: DataTypes.STRING(16),
      allowNull: true,
    },
    coinCost: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    femaleCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    femaleAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    indexes: [
      { fields: ["roomId", "createdAt"] },
      { fields: ["sessionId", "createdAt"] },
      { fields: ["receiverId"] },
      { fields: ["senderId"] },
    ],
  }
);
