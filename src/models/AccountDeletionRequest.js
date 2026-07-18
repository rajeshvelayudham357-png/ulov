import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const AccountDeletionRequest = sequelize.define(
  "AccountDeletionRequest",
  {
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
      // pending | approved | rejected
    },
    rejectReason: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    displayName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    gender: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "account_deletion_requests",
    indexes: [
      {
        fields: ["userId"],
      },
      {
        fields: ["status"],
      },
    ],
  }
);
