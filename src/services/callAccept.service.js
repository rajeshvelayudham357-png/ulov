import { CALL_MODES } from "../constants/quickConnect.js";
import {
  buildQuickConnectAcceptAck,
  resolveQuickConnectContext,
  tryAcceptQuickConnectAttempt,
} from "./quickConnect.service.js";
import {
  findActiveCallForReceiver,
} from "./callState.service.js";

/**
 * Direct / Quick Connect accept validation (no socket IO).
 * Returns { accepted, reason?, mode } — does not emit events or mutate call rows.
 */
export const evaluateCallAcceptRequest = async (data = {}) => {
  const callerId = data?.callerId;
  const receiverId = data?.receiverId;

  const quickConnectContext = await resolveQuickConnectContext({
    callId: data?.callId,
    attemptId: data?.attemptId,
    sessionId: data?.sessionId,
  });

  if (
    quickConnectContext.mode === CALL_MODES.QUICK_CONNECT &&
    quickConnectContext.attempt
  ) {
    const acceptResult = await tryAcceptQuickConnectAttempt({
      attemptId: quickConnectContext.attempt.id,
      callerId,
      receiverId,
    });

    return buildQuickConnectAcceptAck(acceptResult);
  }

  if (callerId && receiverId) {
    const otherCall = await findActiveCallForReceiver(receiverId, callerId);

    if (otherCall) {
      return {
        accepted: false,
        reason: "busy",
        mode: CALL_MODES.DIRECT,
      };
    }
  }

  return {
    accepted: true,
    mode: CALL_MODES.DIRECT,
  };
};
