import { DataTypes } from "sequelize";

import {
  sequelize
} from "../config/database.js";


export const User = sequelize.define(
  "users",
  {

    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    publicUserId: {
      type: DataTypes.STRING(8),
      unique: true,
      allowNull: true,
    },


    // BASIC DETAILS

    name: {
      type: DataTypes.STRING,
      defaultValue: "New User",
    },


    username: {
      type: DataTypes.STRING,
      unique: true,
    },


    email: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: true,
    },


    phone: {
      type: DataTypes.STRING,
      unique: true,
    },

    loginPinHash: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    languages:{
      type:DataTypes.JSON
     },


    // PROFILE DETAILS

    nickname: {
      type: DataTypes.STRING,
    },


    bio: {
      type: DataTypes.TEXT,
    },


    avatar: {
      type: DataTypes.TEXT,
    },


    gender: {
      type: DataTypes.STRING,
    },


    age: {
      type: DataTypes.INTEGER,
    },


    preferredAge: {
      type: DataTypes.STRING,
    },


    interests: {
      type: DataTypes.JSON,
    },


    // VERIFICATION

    verificationType: {
      type: DataTypes.STRING,
    },


    audioVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    verificationAudioUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    verificationSentence: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    verificationVideoUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },


    videoVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },


    verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    accountStatus: {
      type: DataTypes.STRING(20),
      defaultValue: "pending",
    },

    rejectionReasons: {
      type: DataTypes.TEXT,
      allowNull: true,
    },


    // STATUS

    online: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    acceptVoiceCalls: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

    acceptVideoCalls: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

    notificationsEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

    phoneVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },


    lastSeen: {
      type: DataTypes.DATE,
    },


    // MATCHING

    likes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },




    totalCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    profileCompleted: {

      type:
      DataTypes.BOOLEAN,
     
      defaultValue:
      false
     
     },

    welcomeOfferClaimed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    }

  },

  {
    timestamps: true,
  }

);