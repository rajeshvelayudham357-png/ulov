/**
 * Direct Call regression — ensures Quick Connect does not alter direct paths.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { sequelize } from "../../config/database.js";
import { CALL_MODES, QC_TABLES } from "../../constants/quickConnect.js";
import { CallHistory } from "../../models/index.js";
import { createVideoCall } from "../../controllers/call.controller.js";
import { normalizeCallMode } from "../../constants/quickConnect.js";
import {
  IDS,
  cleanupAllHarnessData,
  countQcSessionsForCaller,
  createMockRes,
  seedEligibleCreators,
  upsertTestUser,
} from "./helpers/qcTestHarness.js";

test.before(async () => {
  await cleanupAllHarnessData();
  await seedEligibleCreators();
});

test.after(async () => {
  await cleanupAllHarnessData();
  await sequelize.close();
});

const directCreate = async (body) => {
  const res = createMockRes();
  await createVideoCall({ body }, res);
  return res;
};

test("normalizeCallMode defaults to direct when mode omitted", () => {
  assert.equal(normalizeCallMode(undefined), CALL_MODES.DIRECT);
  assert.equal(normalizeCallMode("direct"), CALL_MODES.DIRECT);
  assert.notEqual(normalizeCallMode(undefined), CALL_MODES.QUICK_CONNECT);
});

test("POST /call/create without mode requires callerId and receiverId", async () => {
  const missing = await directCreate({ type: "voice" });
  assert.equal(missing.statusCode, 400);
  assert.match(missing.body.message, /required/i);
});

test("POST /call/create mode=direct behaves like default direct call", async () => {
  await upsertTestUser({
    id: IDS.MALE,
    gender: "Male",
    online: true,
  });

  await upsertTestUser({
    id: IDS.CREATOR_A,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: false,
  });

  const qcBefore = await countQcSessionsForCaller(IDS.MALE);

  const res = await directCreate({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    mode: "direct",
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.callId);
  assert.ok(res.body.channelName);
  assert.ok(res.body.caller?.token);
  assert.ok(res.body.receiver?.token);
  assert.ok(res.body.appId);

  const history = await CallHistory.findByPk(res.body.callId);
  assert.ok(history);
  assert.equal(Number(history.callerId), IDS.MALE);
  assert.equal(Number(history.receiverId), IDS.CREATOR_A);
  assert.equal(Number(history.coinsSpent), 0);
  assert.equal(history.status, "live");

  const qcAfter = await countQcSessionsForCaller(IDS.MALE);
  assert.equal(qcAfter, qcBefore);

  const [qcRows] = await sequelize.query(
    `SELECT COUNT(*) AS total FROM ${QC_TABLES.SESSIONS} WHERE callerId = :callerId`,
    { replacements: { callerId: IDS.MALE } }
  );
  assert.equal(Number(qcRows[0].total), 0);

  await CallHistory.destroy({ where: { id: res.body.callId } });
});

test("Direct call without mode does not create Quick Connect session", async () => {
  await upsertTestUser({
    id: IDS.MALE,
    gender: "Male",
    online: true,
  });

  await upsertTestUser({
    id: IDS.CREATOR_B,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: false,
  });

  const res = await directCreate({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_B,
    type: "voice",
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.callId);
  assert.equal(res.body.mode, undefined);

  const [attemptRows] = await sequelize.query(
    `SELECT COUNT(*) AS total FROM ${QC_TABLES.ATTEMPTS} ca
     INNER JOIN ${QC_TABLES.SESSIONS} cs ON cs.id = ca.sessionId
     WHERE cs.callerId = :callerId`,
    { replacements: { callerId: IDS.MALE } }
  );
  assert.equal(Number(attemptRows[0].total), 0);

  await CallHistory.destroy({ where: { id: res.body.callId } });
});

test("Direct call rejects offline receiver", async () => {
  await upsertTestUser({
    id: IDS.MALE,
    gender: "Male",
    online: true,
  });

  await upsertTestUser({
    id: IDS.CREATOR_OFFLINE,
    gender: "Female",
    online: false,
    acceptAutoRoutedCalls: false,
  });

  const res = await directCreate({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_OFFLINE,
    type: "voice",
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.offline, true);
});

test("Quick Connect rejects receiverId on create", async () => {
  const res = await directCreate({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_A,
    type: "voice",
    mode: "quick_connect",
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /does not accept receiverId/i);
});

test("Direct call does not require acceptAutoRoutedCalls", async () => {
  await upsertTestUser({
    id: IDS.MALE,
    gender: "Male",
    online: true,
  });

  await upsertTestUser({
    id: IDS.CREATOR_NO_AUTO,
    gender: "Female",
    online: true,
    acceptAutoRoutedCalls: false,
  });

  const res = await directCreate({
    callerId: IDS.MALE,
    receiverId: IDS.CREATOR_NO_AUTO,
    type: "voice",
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.callId);

  await CallHistory.destroy({ where: { id: res.body.callId } });
});
