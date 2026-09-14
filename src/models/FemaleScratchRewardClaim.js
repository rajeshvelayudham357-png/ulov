import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const FemaleScratchRewardClaim = sequelize.define(
  "female_scratch_reward_claims",
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

    claimedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["rewardId", "userId"],
        name: "unique_female_scratch_reward_claim",
      },
    ],
  }
);
