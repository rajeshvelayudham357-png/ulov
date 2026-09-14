import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { BATTLE_ROOM_STATUSES } from "../constants/battle.js";

export const BattleRoom = sequelize.define(
  "battle_rooms",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    inviteId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: BATTLE_ROOM_STATUSES.ACCEPTED,
    },
    durationSeconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    startsAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    endsAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    settledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    winnerFighterId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    agoraChannelName: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
  },
  {
    indexes: [
      { fields: ["status"] },
      { fields: ["inviteId"], unique: true, name: "uniq_battle_room_invite" },
      { fields: ["endsAt"] },
    ],
  }
);
