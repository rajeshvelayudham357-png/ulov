import test from "node:test";
import assert from "node:assert/strict";

import { shouldRecordCallAttemptedEngagement } from "../callEngagementPolicy.js";
import { ENGAGEMENT_EVENT_TYPES } from "../../constants/engagementEventTypes.js";

test("shouldRecordCallAttemptedEngagement: new call history => true", () => {
  assert.equal(
    shouldRecordCallAttemptedEngagement({ createdNewCallHistory: true }),
    true
  );
});

test("shouldRecordCallAttemptedEngagement: existing call re-upsert => false", () => {
  assert.equal(
    shouldRecordCallAttemptedEngagement({ createdNewCallHistory: false }),
    false
  );
});

test("shouldRecordCallAttemptedEngagement: socket reconnect update => false", () => {
  assert.equal(shouldRecordCallAttemptedEngagement(), false);
});

test("CALL_COMPLETED event type unchanged", () => {
  assert.equal(ENGAGEMENT_EVENT_TYPES.CALL_COMPLETED, "CALL_COMPLETED");
});
