import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKFILL_EPOCH_ARTIFACT,
  mergeEngagementTimestamp,
  mergeEngagementTimestampOnDuplicateSql,
} from "../userEngagementBackfillMerge.js";

const t1 = new Date("2026-09-01T10:00:00.000Z");
const t2 = new Date("2026-09-10T10:00:00.000Z");

test("mergeEngagementTimestamp: NULL incoming + NULL existing => NULL", () => {
  assert.equal(mergeEngagementTimestamp(null, null), null);
  assert.equal(mergeEngagementTimestamp(undefined, null), null);
});

test("mergeEngagementTimestamp: NULL incoming + existing => existing", () => {
  assert.equal(mergeEngagementTimestamp(t1, null), t1);
});

test("mergeEngagementTimestamp: incoming + NULL existing => incoming", () => {
  assert.equal(mergeEngagementTimestamp(null, t1), t1);
});

test("mergeEngagementTimestamp: newer incoming => newer", () => {
  assert.equal(mergeEngagementTimestamp(t1, t2), t2);
});

test("mergeEngagementTimestamp: older incoming => existing newer", () => {
  assert.equal(mergeEngagementTimestamp(t2, t1), t2);
});

test("mergeEngagementTimestampOnDuplicateSql uses CASE without sentinel", () => {
  const sql = mergeEngagementTimestampOnDuplicateSql("last_chat_at");
  assert.match(sql, /WHEN VALUES\(last_chat_at\) IS NULL THEN/);
  assert.match(sql, /GREATEST\(user_engagement_stats\.last_chat_at, VALUES\(last_chat_at\)\)/);
  assert.doesNotMatch(sql, /1970/);
  assert.doesNotMatch(sql, new RegExp(BACKFILL_EPOCH_ARTIFACT));
});
