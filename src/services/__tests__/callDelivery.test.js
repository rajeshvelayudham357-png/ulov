import test from "node:test";
import assert from "node:assert/strict";

import {
  logCallDeliveryEvent,
  routeIncomingCallToCreator,
  recordClientCallDeliveryEvent,
} from "../callDelivery.service.js";

test("routeIncomingCallToCreator attempts socket and push", async () => {
  const emitted = [];
  const io = {
    to: () => ({
      emit: (event, payload) => {
        emitted.push({ event, payload });
      },
    }),
  };

  const onlineUsers = new Map([["42", "socket-42"]]);

  const result = await routeIncomingCallToCreator({
    io,
    onlineUsers,
    data: {
      callId: "9001",
      callerId: "7",
      receiverId: "42",
      callerName: "Raj",
      type: "audio",
    },
    creatorOnlineInDb: true,
  });

  assert.equal(result.routed, true);
  assert.equal(result.socketDelivered, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "incoming-call");
  assert.equal(emitted[0].payload.serverRouted, true);
});

test("recordClientCallDeliveryEvent rejects invalid events", async () => {
  await assert.rejects(
    () =>
      recordClientCallDeliveryEvent({
        userId: 42,
        callId: "1",
        event: "NOT_A_REAL_EVENT",
      }),
    /Invalid call delivery event/
  );
});

test("logCallDeliveryEvent ignores unknown events", async () => {
  const result = await logCallDeliveryEvent({
    callId: "1",
    callerId: 2,
    creatorId: 3,
    event: "UNKNOWN",
  });

  assert.equal(result, null);
});
