import test from "node:test";
import assert from "node:assert/strict";

import {
  BATTLE_FIGHTER_SLOTS,
  BATTLE_INVITE_STATUSES,
  BATTLE_ROOM_STATUSES,
  DEFAULT_BATTLE_SETTINGS,
  getBattleChannelName,
} from "../../constants/battle.js";
import {
  ensureBattleSchema,
  getBattleSettings,
  resetBattleSchemaCacheForTests,
} from "../battleSchema.service.js";
import { getBattleFeatureStatusHandler } from "../../controllers/battle.controller.js";

const createMockRes = () => {
  let statusCode = 200;
  let body = null;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
};

test("battle constants define isolated channel naming", () => {
  assert.equal(getBattleChannelName(42), "battle_42");
  assert.equal(BATTLE_FIGHTER_SLOTS.A, "A");
  assert.equal(BATTLE_FIGHTER_SLOTS.B, "B");
  assert.equal(BATTLE_INVITE_STATUSES.PENDING, "pending");
  assert.equal(BATTLE_ROOM_STATUSES.LIVE, "live");
});

test("battle settings table defaults are isolated from voice rooms", async () => {
  await ensureBattleSchema();
  resetBattleSchemaCacheForTests();

  const settings = await getBattleSettings();

  assert.equal(typeof settings.enabled, "boolean");
  assert.equal(
    settings.defaultDurationSeconds,
    DEFAULT_BATTLE_SETTINGS.defaultDurationSeconds
  );
  assert.equal(
    settings.inviteTimeoutSeconds,
    DEFAULT_BATTLE_SETTINGS.inviteTimeoutSeconds
  );
});

test("battle feature status endpoint returns disabled by default", async () => {
  await ensureBattleSchema();

  const res = createMockRes();
  await getBattleFeatureStatusHandler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.enabled, "boolean");
  assert.equal(typeof res.body.defaultDurationSeconds, "number");
});
