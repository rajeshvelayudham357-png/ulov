import {
  adminForceCloseVoiceRoom,
  closeVoiceRoom,
  createVoiceRoom,
  getVoiceRoomDetail,
  getVoiceRoomFeatureStatus,
  listAdminLiveVoiceRooms,
  listLiveVoiceRooms,
  startVoiceRoom,
  VoiceRoomFeatureDisabledError,
} from "../services/voiceRoom.service.js";
import {
  joinVoiceRoomSeat,
  leaveVoiceRoomSeat,
  VoiceRoomAuthorizationError,
  VoiceRoomMembershipConflictError,
  VoiceRoomSeatConflictError,
  VoiceRoomUserInCallError,
} from "../services/voiceRoomSeat.service.js";
import {
  getVoiceRoomAgoraCredentials,
  VoiceRoomAgoraAuthorizationError,
  VoiceRoomAgoraNotFoundError,
  VoiceRoomAgoraUnavailableError,
} from "../services/voiceRoomAgora.service.js";
import {
  getVoiceRoomSettings,
  updateVoiceRoomSettings,
} from "../services/voiceRoomSchema.service.js";
import {
  listVoiceRoomChatMessages,
  sendVoiceRoomChatMessage,
} from "../services/voiceRoomChat.service.js";
import {
  listVoiceRoomGiftsCatalog,
  sendVoiceRoomGift,
} from "../services/voiceRoomGift.service.js";

const mapVoiceRoomError = (error, res) => {
  if (error instanceof VoiceRoomFeatureDisabledError) {
    return res.status(error.statusCode).json({
      message: error.message,
    });
  }

  if (
    error instanceof VoiceRoomSeatConflictError ||
    error instanceof VoiceRoomMembershipConflictError ||
    error instanceof VoiceRoomUserInCallError
  ) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (error instanceof VoiceRoomAuthorizationError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  const message = error?.message || "Voice room request failed";

  if (/not found/i.test(message)) {
    return res.status(404).json({ message });
  }

  if (/only the host|required|can no longer|not live|session not found/i.test(message)) {
    return res.status(400).json({ message });
  }

  if (/already occupied|already in|already seated|finish your current call|another voice room/i.test(message)) {
    return res.status(409).json({ message });
  }

  if (/membership not found|not allowed/i.test(message)) {
    return res.status(403).json({ message });
  }

  if (/insufficient gold balance/i.test(message)) {
    return res.status(400).json({ message });
  }

  if (/cannot send a gift|only male|only be sent to female|invalid gift|invalid receiver/i.test(message)) {
    return res.status(400).json({ message });
  }

  if (/message cannot be empty|characters or fewer/i.test(message)) {
    return res.status(400).json({ message });
  }

  if (
    error?.name === "SequelizeUniqueConstraintError" ||
    error?.name === "SequelizeValidationError"
  ) {
    return res.status(409).json({
      message:
        "You are already in another voice room. Leave that room and try again.",
    });
  }

  return res.status(500).json({ message });
};

const mapVoiceRoomAgoraError = (error, res) => {
  if (error instanceof VoiceRoomFeatureDisabledError) {
    return res.status(error.statusCode).json({
      message: error.message,
    });
  }

  if (error instanceof VoiceRoomAgoraAuthorizationError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (error instanceof VoiceRoomAgoraNotFoundError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (error instanceof VoiceRoomAgoraUnavailableError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  const message = error?.message || "Voice room Agora request failed";

  if (/not configured/i.test(message)) {
    return res.status(503).json({ message });
  }

  return res.status(500).json({ message });
};

export const getVoiceRoomFeatureStatusHandler = async (_req, res) => {
  try {
    const status = await getVoiceRoomFeatureStatus();
    return res.json(status);
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const createVoiceRoomHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const room = await createVoiceRoom(userId, req.body ?? {});
    return res.status(201).json({ room });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const listLiveVoiceRoomsHandler = async (_req, res) => {
  try {
    const rooms = await listLiveVoiceRooms();
    return res.json({ rooms });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const getVoiceRoomHandler = async (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    const room = await getVoiceRoomDetail(req.params.roomId, userId);
    return res.json({ room });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const startVoiceRoomHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const room = await startVoiceRoom(userId, req.params.roomId);
    return res.json({ room });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const closeVoiceRoomHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const result = await closeVoiceRoom(userId, req.params.roomId);
    return res.json(result);
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const joinVoiceRoomSeatHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const room = await joinVoiceRoomSeat(
      userId,
      req.params.roomId,
      req.params.seatIndex
    );

    return res.json({ room });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const leaveVoiceRoomSeatHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const room = await leaveVoiceRoomSeat(
      userId,
      req.params.roomId,
      req.params.seatIndex
    );

    return res.json({ room });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const leaveVoiceRoomHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const room = await leaveVoiceRoomSeat(userId, req.params.roomId);

    return res.json({ room });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const getVoiceRoomAgoraTokenHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const agora = await getVoiceRoomAgoraCredentials(userId, req.params.roomId);
    return res.json({ agora });
  } catch (error) {
    return mapVoiceRoomAgoraError(error, res);
  }
};

export const getVoiceRoomAdminSettingsHandler = async (_req, res) => {
  try {
    const settings = await getVoiceRoomSettings();
    return res.json(settings);
  } catch (error) {
    return res.status(500).json({
      message: error?.message || "Failed to load voice room settings",
    });
  }
};

export const updateVoiceRoomAdminSettingsHandler = async (req, res) => {
  try {
    const settings = await updateVoiceRoomSettings({
      enabled: req.body?.enabled,
      maxSeats: req.body?.maxSeats,
    });

    return res.json({
      message: settings.enabled
        ? "Voice Rooms enabled for the mobile app"
        : "Voice Rooms disabled for the mobile app",
      settings,
    });
  } catch (error) {
    return res.status(500).json({
      message: error?.message || "Failed to update voice room settings",
    });
  }
};

export const listAdminLiveVoiceRoomsHandler = async (_req, res) => {
  try {
    const rooms = await listAdminLiveVoiceRooms();
    return res.json({ rooms });
  } catch (error) {
    return res.status(500).json({
      message: error?.message || "Failed to load live voice rooms",
    });
  }
};

export const deleteAdminVoiceRoomHandler = async (req, res) => {
  try {
    const result = await adminForceCloseVoiceRoom(req.params.roomId);

    return res.json({
      message: result.alreadyClosed
        ? "Voice room was already closed"
        : "Voice room deleted successfully",
      room: result,
    });
  } catch (error) {
    if (/not found/i.test(error?.message || "")) {
      return res.status(404).json({ message: error.message });
    }

    return res.status(500).json({
      message: error?.message || "Failed to delete voice room",
    });
  }
};

export const getVoiceRoomChatHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const messages = await listVoiceRoomChatMessages(userId, req.params.roomId, {
      limit: req.query.limit,
      beforeId: req.query.beforeId,
    });

    return res.json({ messages });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const sendVoiceRoomChatHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const message = await sendVoiceRoomChatMessage(
      userId,
      req.params.roomId,
      req.body?.messageText
    );

    return res.status(201).json({ message });
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};

export const getVoiceRoomGiftsCatalogHandler = async (_req, res) => {
  try {
    const gifts = await listVoiceRoomGiftsCatalog();
    return res.json({ gifts });
  } catch (error) {
    return res.status(500).json({
      message: error?.message || "Failed to load voice room gifts",
    });
  }
};

export const sendVoiceRoomGiftHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const result = await sendVoiceRoomGift({
      senderId: userId,
      roomId: req.params.roomId,
      receiverId: req.body?.receiverId,
      giftId: req.body?.giftId,
    });

    return res.status(201).json(result);
  } catch (error) {
    return mapVoiceRoomError(error, res);
  }
};
