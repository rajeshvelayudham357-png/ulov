import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const MaleScratchRewardClaim = sequelize.define(
  "male_scratch_reward_claims",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    rewardId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    coins: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "pending",
    },

    claimedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["rewardId", "userId"],
        name: "unique_male_scratch_reward_claim",
      },
    ],
  }
);
