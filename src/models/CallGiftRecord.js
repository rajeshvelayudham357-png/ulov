import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const CallGiftRecord = sequelize.define(
  "call_gift_records",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
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
    callSessionId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    indexes: [
      { fields: ["receiverId", "createdAt"] },
      { fields: ["senderId"] },
    ],
  }
);
