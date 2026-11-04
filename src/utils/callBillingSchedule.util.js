/**
 * Prepaid billing intervals, identical to the schedule the app used to charge:
 *
 * video: #0 at 0 s   = ceil(rate / 2), covers 0-30 s
 *        #1 at 30 s  = ceil(rate / 2), covers 30-60 s
 *        #k at (k-1) x 60 s = ceil(rate), covers (k-1) x 60 - k x 60 s   (k >= 2)
 * voice: #k at k x 60 s = ceil(rate), covers k x 60 - (k+1) x 60 s       (k >= 0)
 *
 * Seconds are billable seconds (video pauses while the creator's face is
 * missing and the restriction is on).
 */

const isVoice = (type) => {
  const value = String(type ?? "video").toLowerCase();
  return value === "voice" || value === "audio";
};

const halfRate = (ratePerMinute) => Math.max(1, Math.ceil(Number(ratePerMinute) / 2));
const fullRate = (ratePerMinute) => Math.max(1, Math.ceil(Number(ratePerMinute)));

export const getIntervalStartSecond = (type, index) => {
  if (isVoice(type)) {
    return index * 60;
  }

  if (index === 0) {
    return 0;
  }

  return index === 1 ? 30 : (index - 1) * 60;
};

export const getIntervalEndSecond = (type, index) => {
  if (isVoice(type)) {
    return (index + 1) * 60;
  }

  if (index === 0) {
    return 30;
  }

  return index === 1 ? 60 : index * 60;
};

export const getIntervalAmount = (type, index, ratePerMinute) =>
  !isVoice(type) && index <= 1 ? halfRate(ratePerMinute) : fullRate(ratePerMinute);

/** How many intervals must be paid once `billableSeconds` have been used. */
export const getDueIntervalCount = (type, billableSeconds) => {
  const seconds = Math.max(0, Math.floor(Number(billableSeconds) || 0));

  if (isVoice(type)) {
    return Math.floor(seconds / 60) + 1;
  }

  if (seconds < 30) {
    return 1;
  }

  return seconds < 60 ? 2 : Math.floor(seconds / 60) + 2;
};

export const describeInterval = (type, index, ratePerMinute) => ({
  intervalIndex: index,
  coversFromSecond: getIntervalStartSecond(type, index),
  coversToSecond: getIntervalEndSecond(type, index),
  amount: getIntervalAmount(type, index, ratePerMinute),
});
