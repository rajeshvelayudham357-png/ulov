// Legacy POST /api/call/end. It trusted client-supplied user ids and durations,
// debited wallets without a balance check and created creator earnings. No
// current client uses it; calls are finalised through POST /api/calls/end.
export const endCall = async (_req, res) =>
  res.status(410).json({
    code: "ENDPOINT_DISABLED",
    message: "This endpoint is no longer available. Use /api/calls/end.",
  });
