import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { BATTLE_AUDIENCE_STATUSES } from "../constants/battle.js";

export const BattleAudienceSession = sequelize.define(
  "battle_audience_sessions",
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
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: BATTLE_AUDIENCE_STATUSES.JOINING,
    },
    joinedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    leftAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    indexes: [
      { fields: ["battleId", "userId"] },
      { fields: ["battleId", "status"] },
      { fields: ["userId"] },
    ],
  }
);
