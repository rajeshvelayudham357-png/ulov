import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import { BATTLE_INVITE_STATUSES } from "../constants/battle.js";

export const BattleInvite = sequelize.define(
  "battle_invites",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    challengerId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    opponentId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: BATTLE_INVITE_STATUSES.PENDING,
    },
    durationSeconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    battleId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    indexes: [
      { fields: ["challengerId", "status"] },
      { fields: ["opponentId", "status"] },
      { fields: ["expiresAt"] },
    ],
  }
);
