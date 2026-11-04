import { computeCreatorEarnings, computeMaleCallCost } from "./callRate.util.js";

const toSeconds = (value) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const toTime = (value) => {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

/**
 * Call length the server is willing to bill, in whole seconds.
 *
 * When the server saw the call being accepted, the length is the server's own
 * accepted-to-ended span and anything the client reports is ignored. Calls
 * accepted before `acceptedAt` existed fall back to the client's number, capped
 * by the time since the call row was created so it can never be inflated.
 */
export const resolveRecordedDuration = ({
  acceptedAt,
  endedAt,
  createdAt,
  clientDuration,
  storedDuration,
  now = Date.now(),
}) => {
  const endTime = toTime(endedAt) ?? now;
  const acceptedTime = toTime(acceptedAt);

  if (acceptedTime !== null) {
    return Math.max(0, Math.floor((endTime - acceptedTime) / 1000));
  }

  const createdTime = toTime(createdAt);
  const claimed = Math.max(toSeconds(clientDuration), toSeconds(storedDuration));

  if (createdTime === null) {
    return 0;
  }

  const wallClock = Math.max(0, Math.floor((endTime - createdTime) / 1000));
  return Math.min(claimed, wallClock);
};

/** Coins a creator can earn from: what was collected, never above the call's cost. */
export const computeEarnableCoins = ({ collectedCoins, recordedCost }) => {
  const collected = Math.max(0, Math.floor(Number(collectedCoins) || 0));
  const cost = Math.max(0, Math.floor(Number(recordedCost) || 0));
  return Math.min(collected, cost);
};

export const computeSettlementEarnings = ({
  collectedCoins,
  recordedCost,
  coinValue,
  creatorPercentage,
}) => {
  const earnableCoins = computeEarnableCoins({ collectedCoins, recordedCost });
  const earnings = computeCreatorEarnings({
    maleCost: earnableCoins,
    coinValue,
    creatorPercentage,
  });

  return {
    earnableCoins,
    femaleEarn: earnings.femaleEarn,
    femaleAmount: earnings.femaleAmount,
    femaleEarningPercentage: earnings.femaleEarningPercentage,
  };
};

/**
 * Coins needed for the first billing interval, matching the app's schedule:
 * video bills half the per-minute rate for the first 30 seconds, voice bills a
 * full minute up front.
 */
export const computeInitialCallCharge = ({ type, ratePerMinute }) =>
  computeMaleCallCost({
    durationSeconds: 1,
    type,
    ratePerMinute,
  }).maleCost;
