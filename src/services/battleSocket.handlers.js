import {
  emitBattleStateToSocket,
  getBattleSocketRoomName,
  resolveSocketUserId,
  verifyBattleSocketAccess,
} from "./battleRealtime.service.js";
import { BattleFeatureDisabledError } from "./battle.errors.js";

const sendSocketError = (ack, message, code = "BATTLE_SOCKET_ERROR") => {
  if (typeof ack === "function") {
    ack({
      ok: false,
      code,
      message,
    });
  }
};

const sendSocketSuccess = (ack, payload = {}) => {
  if (typeof ack === "function") {
    ack({
      ok: true,
      ...payload,
    });
  }
};

export const registerBattleSocketHandlers = (io, socket, onlineUsers) => {
  socket.on("battle:join", async (data, ack) => {
    try {
      const userId = resolveSocketUserId(socket.id, onlineUsers);

      if (!userId) {
        sendSocketError(ack, "Authentication required", "UNAUTHORIZED");
        return;
      }

      const battleId = Number(data?.battleId);

      if (!Number.isFinite(battleId) || battleId <= 0) {
        sendSocketError(ack, "Battle not found", "BATTLE_NOT_FOUND");
        return;
      }

      await verifyBattleSocketAccess(userId, battleId);

      const socketRoomName = getBattleSocketRoomName(battleId);
      await socket.join(socketRoomName);

      if (!socket.data.battleSubscriptions) {
        socket.data.battleSubscriptions = new Set();
      }

      socket.data.battleSubscriptions.add(String(battleId));

      const battle = await emitBattleStateToSocket(socket, battleId, userId);

      sendSocketSuccess(ack, {
        battleId,
        socketRoom: socketRoomName,
        battle,
      });
    } catch (error) {
      if (error instanceof BattleFeatureDisabledError) {
        sendSocketError(ack, error.message, "FEATURE_DISABLED");
        return;
      }

      sendSocketError(
        ack,
        error?.message || "Could not join battle socket",
        "JOIN_FAILED"
      );
    }
  });

  socket.on("battle:leave", async (data, ack) => {
    try {
      const userId = resolveSocketUserId(socket.id, onlineUsers);

      if (!userId) {
        sendSocketError(ack, "Authentication required", "UNAUTHORIZED");
        return;
      }

      const battleId = Number(data?.battleId);

      if (!Number.isFinite(battleId) || battleId <= 0) {
        sendSocketError(ack, "Battle not found", "BATTLE_NOT_FOUND");
        return;
      }

      const socketRoomName = getBattleSocketRoomName(battleId);
      await socket.leave(socketRoomName);

      if (socket.data.battleSubscriptions) {
        socket.data.battleSubscriptions.delete(String(battleId));
      }

      sendSocketSuccess(ack, {
        battleId,
        socketRoom: socketRoomName,
      });
    } catch (error) {
      sendSocketError(
        ack,
        error?.message || "Could not leave battle socket",
        "LEAVE_FAILED"
      );
    }
  });

  socket.on("battle:request-state", async (data, ack) => {
    try {
      const userId = resolveSocketUserId(socket.id, onlineUsers);

      if (!userId) {
        sendSocketError(ack, "Authentication required", "UNAUTHORIZED");
        return;
      }

      const battleId = Number(data?.battleId);

      if (!Number.isFinite(battleId) || battleId <= 0) {
        sendSocketError(ack, "Battle not found", "BATTLE_NOT_FOUND");
        return;
      }

      await verifyBattleSocketAccess(userId, battleId);

      const battle = await emitBattleStateToSocket(socket, battleId, userId);

      sendSocketSuccess(ack, {
        battleId,
        battle,
      });
    } catch (error) {
      if (error instanceof BattleFeatureDisabledError) {
        sendSocketError(ack, error.message, "FEATURE_DISABLED");
        return;
      }

      sendSocketError(
        ack,
        error?.message || "Could not load battle state",
        "STATE_FAILED"
      );
    }
  });

  socket.on("disconnect", () => {
    if (socket.data.battleSubscriptions) {
      socket.data.battleSubscriptions.clear();
    }
  });
};
