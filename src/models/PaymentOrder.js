import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";

export const PaymentOrder = sequelize.define(
  "payment_orders",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    orderId: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true,
    },

    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    packageId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    coins: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },

    paymentSessionId: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    gateway: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "cashfree",
    },

    razorpayOrderId: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },

    razorpayPaymentId: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },

    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "CREATED",
    },

    paymentMethod: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },

    cashfreePaymentId: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },

    failureReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "payment_orders",
    freezeTableName: true,
  }
);
