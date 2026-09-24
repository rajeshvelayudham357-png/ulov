/**
 * Temporary diagnostic logging for direct call delivery (remove after RCA).
 * Does not alter control flow.
 */
export const traceCallDelivery = (fields = {}) => {
  console.log(
    "CALL_DELIVERY_TRACE",
    JSON.stringify({
      ...fields,
      timestamp: new Date().toISOString(),
    })
  );
};
