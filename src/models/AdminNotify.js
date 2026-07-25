import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const AdminNotify = sequelize.define(
  "admin_notifies",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    closable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    targetType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "gender",
    },

    targetGender: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    targetUserIds: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    notifiedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    createdByAdminId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    templateKey: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },

    action: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },

    compositionMode: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "manual",
    },

    emoji: {
      type: DataTypes.STRING(16),
      allowNull: true,
    },
  },
  {
    timestamps: true,
  }
);
