import assert from "node:assert/strict";
import test from "node:test";
import { incomingCallPushPayloadForDevice } from "../incomingCallPushProfile.js";

const payload = {
  title: "Incoming call",
  ttlSeconds: 60,
  data: { type: "incoming_call", callId: "123" },
};

test("updated devices receive the long sound and fresh Android channel", () => {
  const result = incomingCallPushPayloadForDevice(payload, {
    incomingCallNotificationVersion: 1,
  });
  assert.equal(result.androidChannelId, "dating-app-calls-v4");
  assert.equal(result.sound, "incoming_call_ring");
  assert.equal(result.iosSound, "incoming_call_ring.wav");
  assert.equal(result.ttlSeconds, 60);
  assert.equal(result.data, payload.data);
  assert.equal(payload.androidChannelId, undefined);
});

test("legacy and unknown devices never receive an uninstalled channel or sound", () => {
  for (const version of [undefined, null, 0, 2, "1"]) {
    const result = incomingCallPushPayloadForDevice(payload, {
      incomingCallNotificationVersion: version,
    });
    assert.equal(result.androidChannelId, "dating-app-calls-v2");
    assert.equal(result.sound, "incoming_call");
    assert.equal(result.iosSound, "incoming_call.wav");
  }
});

test("mixed app versions resolve independently for the same call", () => {
  const modern = incomingCallPushPayloadForDevice(payload, { incomingCallNotificationVersion: 1 });
  const legacy = incomingCallPushPayloadForDevice(modern, { incomingCallNotificationVersion: 0 });
  assert.equal(modern.androidChannelId, "dating-app-calls-v4");
  assert.equal(legacy.androidChannelId, "dating-app-calls-v2");
});

test("ordinary notifications retain their existing channel and sound", () => {
  const chat = { ...payload, data: { type: "chat_message" }, sound: "default" };
  assert.equal(incomingCallPushPayloadForDevice(chat, { incomingCallNotificationVersion: 1 }), chat);
});
