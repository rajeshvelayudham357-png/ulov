import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const UserOnlineLog = sequelize.define(
  "user_online_logs",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    gender: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    cameOnlineAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    tableName: "user_online_logs",
    freezeTableName: true,
    updatedAt: false,
  }
);
