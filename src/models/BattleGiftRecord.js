import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const BattleGiftRecord = sequelize.define(
  "battle_gift_records",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    battleId: {
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
    fighterSlot: {
      type: DataTypes.STRING(1),
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
    clientRequestId: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
  },
  {
    indexes: [
      { fields: ["battleId", "createdAt"] },
      { fields: ["receiverId"] },
      { fields: ["senderId"] },
      {
        unique: true,
        fields: ["clientRequestId"],
        name: "uniq_battle_gift_client_request",
      },
    ],
  }
);
