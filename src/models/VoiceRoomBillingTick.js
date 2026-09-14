import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const VoiceRoomBillingTick = sequelize.define(
  "voice_room_billing_ticks",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    memberSessionId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    billingMinute: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    walletTransactionId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    indexes: [
      {
        unique: true,
        fields: ["memberSessionId", "billingMinute"],
        name: "uniq_voice_room_member_billing_minute",
      },
      {
        fields: ["memberSessionId"],
      },
    ],
  }
);
