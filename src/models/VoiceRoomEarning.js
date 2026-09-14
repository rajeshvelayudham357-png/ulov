import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { VOICE_ROOM_EARNING_STATUSES } from "../constants/voiceRoom.js";

export const VoiceRoomEarning = sequelize.define(
  "voice_room_earnings",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    roomId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    hostUserId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    grossCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    hostCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    platformCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    hostPercentage: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    ratePerMinute: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: VOICE_ROOM_EARNING_STATUSES.PENDING,
    },
    settledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    indexes: [
      {
        unique: true,
        fields: ["sessionId"],
        name: "uniq_voice_room_earning_session",
      },
      {
        fields: ["hostUserId"],
      },
      {
        fields: ["roomId"],
      },
    ],
  }
);
