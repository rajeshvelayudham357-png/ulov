import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { QueryTypes } from "sequelize";

import { ENGAGEMENT_EVENT_TYPES } from "../../constants/engagementEventTypes.js";
import { sequelize } from "../../config/database.js";
import { trackGrowthEvent } from "../growthEvents.service.js";
import { pickMonotonicTimestamp } from "../engagementRecord.service.js";
import { mapGrowthEventToEngagement } from "../engagementRecord.service.js";
import { ensureUserEngagementStatsSchema } from "../userEngagementSchema.service.js";
import { trackPublicGrowthEvent } from "../../controllers/growthEvents.controller.js";

const hasDatabase = Boolean(
  process.env.DB_NAME && process.env.DB_HOST && process.env.DB_USER
);

const createMockRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

test("mapGrowthEventToEngagement includes APP_OPEN and SESSION_STARTED", () => {
  assert.equal(mapGrowthEventToEngagement("APP_OPEN"), ENGAGEMENT_EVENT_TYPES.APP_OPEN);
  assert.equal(
    mapGrowthEventToEngagement("SESSION_STARTED"),
    ENGAGEMENT_EVENT_TYPES.SESSION_STARTED
  );
});

test("trackPublicGrowthEvent rejects APP_OPEN without auth", async () => {
  const req = {
    body: { eventName: "APP_OPEN", userId: 1 },
    headers: {},
  };
  const res = createMockRes();

  await trackPublicGrowthEvent(req, res);

  assert.equal(res.statusCode, 401);
});

test("trackPublicGrowthEvent rejects invalid event name", async () => {
  const req = {
    body: { eventName: "NOT_VALID" },
    headers: {},
  };
  const res = createMockRes();

  await trackPublicGrowthEvent(req, res);

  assert.equal(res.statusCode, 400);
});

test("APP_OPEN and SESSION_STARTED update engagement columns", {
  skip: !hasDatabase,
}, async () => {
  await ensureUserEngagementStatsSchema();

  const [userRow] = await sequelize.query(
    `SELECT id FROM users WHERE gender IN ('Male','male') ORDER BY id ASC LIMIT 1`,
    { type: QueryTypes.SELECT }
  );
  const userId = Number(userRow?.id);
  assert.ok(userId > 0);

  const appOpenAt = new Date("2026-09-20T10:00:00.000Z");
  const sessionAt = new Date("2026-09-20T11:00:00.000Z");

  const appOpenIdempotencyKey = `test_app_open_${userId}_${Date.now()}`;

  const appOpen = await trackGrowthEvent({
    eventName: "APP_OPEN",
    userId,
    idempotencyKey: appOpenIdempotencyKey,
    createdAt: appOpenAt,
    metadata: { processLaunchId: `test_${Date.now()}` },
  });
  assert.equal(appOpen.tracked, true);

  const session = await trackGrowthEvent({
    eventName: "SESSION_STARTED",
    userId,
    idempotencyKey: `test_session_${userId}_${Date.now()}`,
    createdAt: sessionAt,
    metadata: { sessionKey: `test_session_${Date.now()}` },
  });
  assert.equal(session.tracked, true);

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 100));

  const [stats] = await sequelize.query(
    `SELECT last_app_open_at, last_session_started_at, last_meaningful_activity_at
     FROM user_engagement_stats WHERE userId = :userId`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );

  assert.ok(stats?.last_app_open_at);
  assert.ok(stats?.last_session_started_at);
  assert.ok(
    new Date(stats.last_meaningful_activity_at).getTime() >= sessionAt.getTime()
  );

  const duplicate = await trackGrowthEvent({
    eventName: "APP_OPEN",
    userId,
    idempotencyKey: appOpenIdempotencyKey,
    createdAt: new Date("2026-09-19T09:00:00.000Z"),
    metadata: { processLaunchId: "dup" },
  });
  assert.equal(duplicate.reason, "duplicate");

  const [afterDup] = await sequelize.query(
    `SELECT last_app_open_at FROM user_engagement_stats WHERE userId = :userId`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );

  assert.equal(
    new Date(afterDup.last_app_open_at).toISOString(),
    new Date(stats.last_app_open_at).toISOString()
  );
});

test("recordEngagement monotonic merge keeps newer timestamps", async () => {
  const existing = new Date("2026-09-21T10:00:00.000Z");
  const older = new Date("2026-09-20T10:00:00.000Z");
  assert.equal(pickMonotonicTimestamp(existing, older)?.toISOString(), existing.toISOString());
});

test("authenticated APP_OPEN via controller uses JWT user id", async () => {
  if (!process.env.JWT_SECRET) {
    return;
  }

  const token = jwt.sign({ id: 42 }, process.env.JWT_SECRET);
  const req = {
    body: {
      eventName: "APP_OPEN",
      userId: 99,
      idempotencyKey: "jwt_mismatch_test",
    },
    headers: { authorization: `Bearer ${token}` },
  };
  const res = createMockRes();

  await trackPublicGrowthEvent(req, res);

  assert.equal(res.statusCode, 403);
});
