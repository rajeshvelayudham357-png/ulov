import { finalizeExpiredLiveBattles } from "./battle.service.js";

let watchdogTimer = null;

export const startBattleExpireWatchdog = () => {
  if (watchdogTimer) {
    return;
  }

  const intervalMs = Number(process.env.BATTLE_EXPIRE_WATCHDOG_MS ?? 2000);

  watchdogTimer = setInterval(() => {
    finalizeExpiredLiveBattles().catch((error) => {
      console.log("[BATTLE_EXPIRE_WATCHDOG_ERROR]", error.message);
    });
  }, intervalMs);

  if (typeof watchdogTimer.unref === "function") {
    watchdogTimer.unref();
  }

  finalizeExpiredLiveBattles().catch((error) => {
    console.log("[BATTLE_EXPIRE_WATCHDOG_BOOT_ERROR]", error.message);
  });

  console.log("Battle expire watchdog started");
};

export const stopBattleExpireWatchdog = () => {
  if (!watchdogTimer) {
    return;
  }

  clearInterval(watchdogTimer);
  watchdogTimer = null;
};
