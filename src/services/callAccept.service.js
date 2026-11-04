import { CALL_MODES } from "../constants/quickConnect.js";
import {
  buildQuickConnectAcceptAck,
  resolveQuickConnectContext,
  tryAcceptQuickConnectAttempt,
} from "./quickConnect.service.js";
import { CallHistory } from "../models/index.js";
import {
  findActiveCallByPair,
  findActiveCallForReceiver,
} from "./callState.service.js";
import {
  assertCanAffordInitialCallCharge,
  InsufficientCallBalanceError,
} from "./callSettlement.service.js";

const resolveCallType = async ({ callId, callerId, receiverId, type }) => {
  const id = Number(callId);
  const call =
    Number.isInteger(id) && id > 0
      ? await CallHistory.findByPk(id, { attributes: ["type"] })
      : await findActiveCallByPair(callerId, receiverId);

  return call?.type || type || "video";
};

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

    // The caller's balance may have dropped since the call was created (for
    // example on another call), so check it again at this creator's rate.
    try {
      await assertCanAffordInitialCallCharge({
        callerId,
        receiverId,
        type: await resolveCallType({
          callId: data?.callId,
          callerId,
          receiverId,
          type: data?.type,
        }),
      });
    } catch (error) {
      if (error instanceof InsufficientCallBalanceError) {
        return {
          accepted: false,
          reason: "insufficient_balance",
          mode: CALL_MODES.DIRECT,
        };
      }

      throw error;
    }
  }

  return {
    accepted: true,
    mode: CALL_MODES.DIRECT,
  };
};
