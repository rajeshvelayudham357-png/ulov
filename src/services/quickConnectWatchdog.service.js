import { processExpiredQuickConnectAttempts } from "./quickConnect.service.js";

let watchdogTimer = null;

export const startQuickConnectWatchdog = () => {
  if (watchdogTimer) {
    return;
  }

  const intervalMs = Number(process.env.QUICK_CONNECT_WATCHDOG_MS ?? 1000);

  watchdogTimer = setInterval(() => {
    processExpiredQuickConnectAttempts().catch((error) => {
      console.log("[QUICK_CONNECT_WATCHDOG_ERROR]", error.message);
    });
  }, intervalMs);

  if (typeof watchdogTimer.unref === "function") {
    watchdogTimer.unref();
  }

  processExpiredQuickConnectAttempts().catch((error) => {
    console.log("[QUICK_CONNECT_WATCHDOG_BOOT_ERROR]", error.message);
  });

  console.log("Quick Connect watchdog started");
};

export const stopQuickConnectWatchdog = () => {
  if (!watchdogTimer) {
    return;
  }

  clearInterval(watchdogTimer);
  watchdogTimer = null;
};
