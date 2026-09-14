import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VOICE_ROOM_SETTINGS,
  VOICE_ROOM_EARNING_STATUSES,
  VOICE_ROOM_MEMBER_ROLES,
  VOICE_ROOM_MEMBER_STATUSES,
  VOICE_ROOM_SESSION_STATUSES,
  VOICE_ROOM_STATUSES,
  VOICE_ROOM_WALLET_REFERENCE_TYPE,
  getVoiceRoomChannelName,
} from "../../constants/voiceRoom.js";
import { sequelize } from "../../config/database.js";
import {
  VoiceRoom,
  VoiceRoomBillingTick,
  VoiceRoomEarning,
  VoiceRoomMemberSession,
  VoiceRoomSeat,
  VoiceRoomSession,
} from "../../models/index.js";
import {
  ensureVoiceRoomSchema,
  getVoiceRoomSettings,
  resetVoiceRoomSchemaCacheForTests,
} from "../voiceRoomSchema.service.js";

test("voice room channel names stay isolated from call channels", () => {
  assert.equal(getVoiceRoomChannelName(42), "voice_room_42");
  assert.notEqual(getVoiceRoomChannelName(42), "call_42");
});

test("voice room default settings keep feature disabled", () => {
  assert.equal(DEFAULT_VOICE_ROOM_SETTINGS.enabled, false);
  assert.equal(DEFAULT_VOICE_ROOM_SETTINGS.ratePerMinute, 5);
  assert.equal(DEFAULT_VOICE_ROOM_SETTINGS.maxSeats, 8);
});

test("voice room wallet reference type is isolated from call billing", () => {
  assert.equal(VOICE_ROOM_WALLET_REFERENCE_TYPE, "voice_room");
  assert.notEqual(VOICE_ROOM_WALLET_REFERENCE_TYPE, "call");
});

test("voice room status enums are defined for lifecycle management", () => {
  assert.equal(VOICE_ROOM_STATUSES.DRAFT, "draft");
  assert.equal(VOICE_ROOM_STATUSES.LIVE, "live");
  assert.equal(VOICE_ROOM_STATUSES.CLOSED, "closed");
  assert.equal(VOICE_ROOM_SESSION_STATUSES.LIVE, "live");
  assert.equal(VOICE_ROOM_MEMBER_ROLES.HOST, "host");
  assert.equal(VOICE_ROOM_MEMBER_STATUSES.BILLING, "billing");
  assert.equal(VOICE_ROOM_EARNING_STATUSES.PENDING, "pending");
});

test("voice room models expose expected table names", () => {
  assert.equal(VoiceRoom.getTableName(), "voice_rooms");
  assert.equal(VoiceRoomSession.getTableName(), "voice_room_sessions");
  assert.equal(VoiceRoomSeat.getTableName(), "voice_room_seats");
  assert.equal(
    VoiceRoomMemberSession.getTableName(),
    "voice_room_member_sessions"
  );
  assert.equal(
    VoiceRoomBillingTick.getTableName(),
    "voice_room_billing_ticks"
  );
  assert.equal(VoiceRoomEarning.getTableName(), "voice_room_earnings");
});

test("voice room schema bootstrap creates settings with feature disabled", async () => {
  resetVoiceRoomSchemaCacheForTests();
  await ensureVoiceRoomSchema();

  const settings = await getVoiceRoomSettings();

  assert.equal(settings.enabled, false);
  assert.equal(settings.ratePerMinute, 5);
  assert.equal(settings.hostEarningPercentage, 50);
  assert.equal(settings.billingIntervalSeconds, 60);
  assert.equal(settings.reconnectGraceSeconds, 30);
  assert.equal(settings.maxSeats, 8);
});

test.after(async () => {
  await sequelize.close();
});
