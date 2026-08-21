import test from "node:test";
import assert from "node:assert/strict";

import {
  CALL_MODES,
  ATTEMPT_STATUS,
  DEFAULT_QUICK_CONNECT,
  normalizeCallMode,
  TERMINAL_ATTEMPT_STATUSES,
} from "../../constants/quickConnect.js";

test("normalizeCallMode defaults to direct", () => {
  assert.equal(normalizeCallMode(undefined), CALL_MODES.DIRECT);
  assert.equal(normalizeCallMode(null), CALL_MODES.DIRECT);
  assert.equal(normalizeCallMode(""), CALL_MODES.DIRECT);
  assert.equal(normalizeCallMode("direct"), CALL_MODES.DIRECT);
});

test("normalizeCallMode accepts quick_connect explicitly", () => {
  assert.equal(normalizeCallMode("quick_connect"), CALL_MODES.QUICK_CONNECT);
  assert.equal(normalizeCallMode("QUICK_CONNECT"), CALL_MODES.QUICK_CONNECT);
});

test("quick connect defaults remain 3 attempts and 10 seconds", () => {
  assert.equal(DEFAULT_QUICK_CONNECT.maxAttempts, 3);
  assert.equal(DEFAULT_QUICK_CONNECT.ringTimeoutSeconds, 10);
  assert.equal(DEFAULT_QUICK_CONNECT.maxRoutingSeconds, 30);
  assert.equal(DEFAULT_QUICK_CONNECT.maxSelectionRetries, 20);
});

test("terminal attempt statuses do not include ringing", () => {
  assert.equal(TERMINAL_ATTEMPT_STATUSES.has(ATTEMPT_STATUS.RINGING), false);
  assert.equal(TERMINAL_ATTEMPT_STATUSES.has(ATTEMPT_STATUS.MISSED), true);
  assert.equal(TERMINAL_ATTEMPT_STATUSES.has(ATTEMPT_STATUS.CONNECTED), true);
});

test("direct mode is not quick connect", () => {
  assert.notEqual(normalizeCallMode("direct"), CALL_MODES.QUICK_CONNECT);
});

test("unknown mode values fall back to direct", () => {
  assert.equal(normalizeCallMode("auto"), CALL_MODES.DIRECT);
  assert.equal(normalizeCallMode("fallback"), CALL_MODES.DIRECT);
});
