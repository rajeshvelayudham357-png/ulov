/** Select only native resources known to exist on the registered app. */
export const incomingCallPushPayloadForDevice = (payload, device) => {
  if (payload.data?.type !== "incoming_call") return payload;

  const supportsLongRing = device.incomingCallNotificationVersion === 1;
  return {
    ...payload,
    androidChannelId: supportsLongRing ? "dating-app-calls-v4" : "dating-app-calls-v2",
    sound: supportsLongRing ? "incoming_call_ring" : "incoming_call",
    iosSound: supportsLongRing ? "incoming_call_ring.wav" : "incoming_call.wav",
  };
};
