import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  BATTLE_FIGHTER_SLOTS,
  BATTLE_FIGHTER_STATUSES,
} from "../constants/battle.js";

export const BattleFighter = sequelize.define(
  "battle_fighters",
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
    slot: {
      type: DataTypes.STRING(1),
      allowNull: false,
    },
    scoreCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: BATTLE_FIGHTER_STATUSES.JOINING,
    },
    agoraUid: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    activeFighterGuard: {
      type: DataTypes.STRING(96),
      allowNull: true,
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
      {
        unique: true,
        fields: ["battleId", "slot"],
        name: "uniq_battle_fighter_slot",
      },
      {
        unique: true,
        fields: ["battleId", "userId"],
        name: "uniq_battle_fighter_user",
      },
      {
        unique: true,
        fields: ["activeFighterGuard"],
        name: "uniq_battle_active_fighter_guard",
      },
      { fields: ["userId"] },
    ],
  }
);

export { BATTLE_FIGHTER_SLOTS };
