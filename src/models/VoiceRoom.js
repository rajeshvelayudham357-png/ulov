import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  DEFAULT_VOICE_ROOM_COVER_IMAGE_KEY,
  VOICE_ROOM_STATUSES,
} from "../constants/voiceRoom.js";

export const VoiceRoom = sequelize.define(
  "voice_rooms",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    hostUserId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    maxSeats: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 8,
    },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: VOICE_ROOM_STATUSES.DRAFT,
    },
    coverImageKey: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: DEFAULT_VOICE_ROOM_COVER_IMAGE_KEY,
    },
  },
  {
    indexes: [
      {
        fields: ["hostUserId"],
      },
      {
        fields: ["status"],
      },
    ],
  }
);
