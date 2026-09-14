import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const FemaleScratchReward = sequelize.define(
  "female_scratch_rewards",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    rewardCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    durationSeconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
    },

    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    targetType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "all",
    },

    targetUserIds: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    sentCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    claimedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    createdByAdminId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    timestamps: true,
  }
);
