import {
  emitVoiceRoomStateToSocket,
  getVoiceRoomSocketRoomName,
  resolveSocketUserId,
  verifyVoiceRoomSocketAccess,
  verifyVoiceRoomSocketViewAccess,
} from "./voiceRoomRealtime.service.js";
import { VoiceRoomFeatureDisabledError } from "./voiceRoom.service.js";

const sendSocketError = (ack, message, code = "VOICE_ROOM_SOCKET_ERROR") => {
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

export const registerVoiceRoomSocketHandlers = (io, socket, onlineUsers) => {
  socket.on("voice-room:join", async (data, ack) => {
    try {
      const userId = resolveSocketUserId(socket.id, onlineUsers);

      if (!userId) {
        sendSocketError(ack, "Authentication required", "UNAUTHORIZED");
        return;
      }

      const roomId = Number(data?.roomId);

      if (!Number.isFinite(roomId) || roomId <= 0) {
        sendSocketError(ack, "Voice room not found", "ROOM_NOT_FOUND");
        return;
      }

      await verifyVoiceRoomSocketViewAccess(userId, roomId);

      const socketRoomName = getVoiceRoomSocketRoomName(roomId);
      await socket.join(socketRoomName);

      if (!socket.data.voiceRoomSubscriptions) {
        socket.data.voiceRoomSubscriptions = new Set();
      }

      socket.data.voiceRoomSubscriptions.add(String(roomId));

      const room = await emitVoiceRoomStateToSocket(socket, roomId, userId);

      sendSocketSuccess(ack, {
        roomId,
        socketRoom: socketRoomName,
        room,
      });
    } catch (error) {
      if (error instanceof VoiceRoomFeatureDisabledError) {
        sendSocketError(ack, error.message, "FEATURE_DISABLED");
        return;
      }

      sendSocketError(
        ack,
        error?.message || "Could not join voice room socket",
        "JOIN_FAILED"
      );
    }
  });

  socket.on("voice-room:leave", async (data, ack) => {
    try {
      const userId = resolveSocketUserId(socket.id, onlineUsers);

      if (!userId) {
        sendSocketError(ack, "Authentication required", "UNAUTHORIZED");
        return;
      }

      const roomId = Number(data?.roomId);

      if (!Number.isFinite(roomId) || roomId <= 0) {
        sendSocketError(ack, "Voice room not found", "ROOM_NOT_FOUND");
        return;
      }

      const socketRoomName = getVoiceRoomSocketRoomName(roomId);
      await socket.leave(socketRoomName);

      if (socket.data.voiceRoomSubscriptions) {
        socket.data.voiceRoomSubscriptions.delete(String(roomId));
      }

      sendSocketSuccess(ack, {
        roomId,
        socketRoom: socketRoomName,
      });
    } catch (error) {
      sendSocketError(
        ack,
        error?.message || "Could not leave voice room socket",
        "LEAVE_FAILED"
      );
    }
  });

  socket.on("voice-room:request-state", async (data, ack) => {
    try {
      const userId = resolveSocketUserId(socket.id, onlineUsers);

      if (!userId) {
        sendSocketError(ack, "Authentication required", "UNAUTHORIZED");
        return;
      }

      const roomId = Number(data?.roomId);

      if (!Number.isFinite(roomId) || roomId <= 0) {
        sendSocketError(ack, "Voice room not found", "ROOM_NOT_FOUND");
        return;
      }

      await verifyVoiceRoomSocketAccess(userId, roomId);

      const room = await emitVoiceRoomStateToSocket(socket, roomId, userId);

      sendSocketSuccess(ack, {
        roomId,
        room,
      });
    } catch (error) {
      if (error instanceof VoiceRoomFeatureDisabledError) {
        sendSocketError(ack, error.message, "FEATURE_DISABLED");
        return;
      }

      sendSocketError(
        ack,
        error?.message || "Could not load voice room state",
        "STATE_FAILED"
      );
    }
  });

  socket.on("disconnect", () => {
    if (socket.data.voiceRoomSubscriptions) {
      socket.data.voiceRoomSubscriptions.clear();
    }
  });
};
