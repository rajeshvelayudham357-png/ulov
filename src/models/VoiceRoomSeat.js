import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const VoiceRoomSeat = sequelize.define(
  "voice_room_seats",
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
    seatIndex: {
      type: DataTypes.TINYINT,
      allowNull: false,
    },
    memberSessionId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    indexes: [
      {
        unique: true,
        fields: ["roomId", "seatIndex"],
        name: "uniq_voice_room_seat_index",
      },
      {
        fields: ["roomId"],
      },
    ],
  }
);
