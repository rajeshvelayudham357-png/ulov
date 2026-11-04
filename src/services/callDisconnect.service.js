import { closeActiveCallsForUser } from "./callState.service.js";

export const getCallDisconnectGraceMs = () => {
  const value = Number(process.env.CALL_DISCONNECT_GRACE_MS);
  return Number.isFinite(value) && value >= 0 ? value : 45_000;
};

/**
 * Handles a participant's socket dropping. Calls that were never answered are
 * closed straight away (unchanged behaviour). Answered calls keep running
 * while Agora media may still be flowing; if the user has not re-registered
 * within the grace period they are settled once, ending at the disconnect.
 */
export const handleParticipantDisconnect = async ({
  userId,
  onlineUsers,
  graceMs = getCallDisconnectGraceMs(),
  now = () => new Date(),
}) => {
  const disconnectedAt = now();

  await closeActiveCallsForUser(userId, "completed", {
    unacceptedOnly: true,
  });

  const settle = async () => {
    if (onlineUsers?.has(String(userId))) {
      return { skipped: "reconnected" };
    }

    return closeActiveCallsForUser(userId, "completed", {
      acceptedOnly: true,
      endedAt: disconnectedAt,
      endReason: "participant_disconnected",
    });
  };

  const settlement = new Promise((resolve) => {
    const timer = setTimeout(() => {
      settle()
        .then(resolve)
        .catch((error) => {
          console.log("DISCONNECT SETTLEMENT ERROR", userId, error.message);
          resolve({ error: error.message });
        });
    }, graceMs);

    timer.unref?.();
  });

  return { settlement };
};
