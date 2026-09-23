import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGAGEMENT_BUCKETS,
} from "../maleEngagementBuckets.service.js";

test("getMaleEngagementDashboard is exported", async () => {
  const mod = await import("../adminMaleEngagement.service.js");
  assert.equal(typeof mod.getMaleEngagementDashboard, "function");
});

test("parseMaleEngagementStatusQuery accepts omitted and all", async () => {
  const { parseMaleEngagementStatusQuery } = await import(
    "../adminMaleEngagement.service.js"
  );
  assert.equal(parseMaleEngagementStatusQuery(""), null);
  assert.equal(parseMaleEngagementStatusQuery("all"), null);
  assert.equal(parseMaleEngagementStatusQuery(undefined), null);
});

test("parseMaleEngagementStatusQuery accepts recognized status values", async () => {
  const { parseMaleEngagementStatusQuery } = await import(
    "../adminMaleEngagement.service.js"
  );
  assert.equal(
    parseMaleEngagementStatusQuery("ACTIVE_TODAY"),
    ENGAGEMENT_BUCKETS.ACTIVE_TODAY
  );
  assert.equal(
    parseMaleEngagementStatusQuery("NEVER_ACTIVE"),
    ENGAGEMENT_BUCKETS.NEVER_ACTIVE
  );
  assert.equal(parseMaleEngagementStatusQuery("active_7d"), "ACTIVE_WITHIN_7D");
});

test("parseMaleEngagementStatusQuery rejects INVALID with 400", async () => {
  const { parseMaleEngagementStatusQuery } = await import(
    "../adminMaleEngagement.service.js"
  );

  assert.throws(
    () => parseMaleEngagementStatusQuery("INVALID"),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Invalid status filter");
      return true;
    }
  );
});

test("getMaleEngagementDashboard rejects INVALID status before querying", async () => {
  const { getMaleEngagementDashboard } = await import(
    "../adminMaleEngagement.service.js"
  );

  await assert.rejects(
    () => getMaleEngagementDashboard({ status: "INVALID" }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Invalid status filter");
      return true;
    }
  );
});
