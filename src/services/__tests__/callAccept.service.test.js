import test from "node:test";
import assert from "node:assert/strict";

import { CALL_MODES } from "../../constants/quickConnect.js";
import { evaluateCallAcceptRequest } from "../callAccept.service.js";

test("evaluateCallAcceptRequest is exported", () => {
  assert.equal(typeof evaluateCallAcceptRequest, "function");
});

test("evaluateCallAcceptRequest direct shape when no DB (invalid ids)", async () => {
  const result = await evaluateCallAcceptRequest({
    callerId: null,
    receiverId: null,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.mode, CALL_MODES.DIRECT);
});
