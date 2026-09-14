import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { VOICE_ROOM_SESSION_STATUSES } from "../constants/voiceRoom.js";

export const VoiceRoomSession = sequelize.define(
  "voice_room_sessions",
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
    agoraChannelName: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: VOICE_ROOM_SESSION_STATUSES.LIVE,
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    ratePerMinute: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    },
    hostPercentage: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 50,
    },
  },
  {
    indexes: [
      {
        fields: ["roomId"],
      },
      {
        fields: ["status"],
      },
    ],
  }
);
