import { DataTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  VOICE_ROOM_MEMBER_ROLES,
  VOICE_ROOM_MEMBER_STATUSES,
} from "../constants/voiceRoom.js";

export const VoiceRoomMemberSession = sequelize.define(
  "voice_room_member_sessions",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    roomId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    seatIndex: {
      type: DataTypes.TINYINT,
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: VOICE_ROOM_MEMBER_ROLES.PARTICIPANT,
    },
    status: {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: VOICE_ROOM_MEMBER_STATUSES.JOINING,
    },
    isBillable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    joinedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    leftAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastHeartbeatAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    billingStartedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastBilledMinute: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    coinsSpent: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    agoraUid: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    activeMembershipGuard: {
      type: DataTypes.STRING(96),
      allowNull: true,
    },
  },
  {
    indexes: [
      {
        fields: ["sessionId"],
      },
      {
        fields: ["roomId"],
      },
      {
        fields: ["userId"],
      },
      {
        fields: ["status"],
      },
      {
        unique: true,
        fields: ["activeMembershipGuard"],
        name: "uniq_voice_room_active_membership_guard",
      },
    ],
  }
);
