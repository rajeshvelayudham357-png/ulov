import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMaleLoginActivitySearch,
  applyMaleLoginInactiveDaysFilter,
  buildMaleLoginActivitySummary,
  getDisplayName,
  mapMaleLoginActivityRow,
  pickLatestTimestamp,
} from "../maleLoginActivity.service.js";

test("pickLatestTimestamp picks newest valid date", () => {
  const older = "2024-01-01T00:00:00.000Z";
  const newer = "2025-06-01T12:00:00.000Z";
  assert.equal(
    pickLatestTimestamp(older, null, newer).toISOString(),
    new Date(newer).toISOString()
  );
});

test("pickLatestTimestamp returns null when all inputs empty", () => {
  assert.equal(pickLatestTimestamp(null, undefined, ""), null);
});

test("mapMaleLoginActivityRow preserves null timestamps", () => {
  const mapped = mapMaleLoginActivityRow({
    id: 42,
    publicUserId: "M001",
    name: "New User",
    nickname: "",
    username: "u42",
    phone: "999",
    avatar: null,
    online: 0,
    lastSeen: null,
    lastLoginAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-02-01T00:00:00.000Z",
    lastAppOpenAt: null,
    lastOnlineLogAt: null,
  });

  assert.equal(mapped.id, 42);
  assert.equal(mapped.lastLoginAt, null);
  assert.equal(mapped.lastAppOpenAt, null);
  assert.equal(mapped.lastOnlineLogAt, null);
  assert.equal(mapped.hasLoginRecord, false);
  assert.equal(mapped.hasAppOpenRecord, false);
  assert.equal(mapped.phone, "999");
  assert.equal(mapped.displayName, "u42");
});

test("mapMaleLoginActivityRow sets lastActivityAt from aggregates", () => {
  const appOpen = "2025-01-15T08:00:00.000Z";
  const onlineLog = "2025-01-20T08:00:00.000Z";
  const mapped = mapMaleLoginActivityRow({
    id: 1,
    publicUserId: "",
    name: "A",
    nickname: "",
    username: "",
    phone: "",
    avatar: null,
    online: 1,
    lastSeen: null,
    lastLoginAt: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-06-01T00:00:00.000Z",
    lastAppOpenAt: appOpen,
    lastOnlineLogAt: onlineLog,
  });

  assert.equal(mapped.lastAppOpenAt, appOpen);
  assert.equal(mapped.lastOnlineLogAt, onlineLog);
  assert.equal(mapped.lastActivityAt.toISOString(), new Date(onlineLog).toISOString());
  assert.equal(mapped.hasAppOpenRecord, true);
});

test("applyMaleLoginActivitySearch filters by display name and id", () => {
  const rows = [
    { displayName: "Raj", phone: "—", publicUserId: "X", id: 10 },
    { displayName: "Other", phone: "—", publicUserId: "Y", id: 20 },
  ];
  const filtered = applyMaleLoginActivitySearch(rows, "raj");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 10);
});

test("applyMaleLoginInactiveDaysFilter keeps rows without activity", () => {
  const rows = [
    { lastActivityAt: null },
    {
      lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  const filtered = applyMaleLoginInactiveDaysFilter(rows, 7);
  assert.equal(filtered.length, 2);
});

test("buildMaleLoginActivitySummary counts tracked fields", () => {
  const summary = buildMaleLoginActivitySummary([
    { hasLoginRecord: true, hasAppOpenRecord: false, online: true, lastActivityAt: null },
    { hasLoginRecord: false, hasAppOpenRecord: true, online: false, lastActivityAt: null },
  ]);
  assert.equal(summary.totalMales, 2);
  assert.equal(summary.loggedInTracked, 1);
  assert.equal(summary.appOpenTracked, 1);
  assert.equal(summary.onlineNow, 1);
});

test("getDisplayName prefers nickname over username", () => {
  assert.equal(
    getDisplayName({ nickname: "Nick", username: "user", name: "New User" }),
    "Nick"
  );
});
