import {
  acceptBattleInvite,
  adminForceCloseBattle,
  assertBattleFeatureEnabled,
  BattleConflictError,
  BattleUserInCallError,
  cancelBattleInvite,
  createBattleInvite,
  declineBattleInvite,
  getBattleDetail,
  getBattleFeatureStatus,
  joinBattleAsAudience,
  joinBattleAsFighter,
  leaveBattleAudience,
  listBattleInvites,
  listBattleOpponents,
  listAdminLiveBattles,
  listLiveBattles,
} from "../services/battle.service.js";
import {
  getAdminBattleViewerGifts,
  listAdminFinishedBattles,
} from "../services/adminBattle.service.js";
import {
  getBattleAgoraCredentials,
} from "../services/battleAgora.service.js";
import {
  BattleAgoraAuthorizationError,
  BattleAgoraNotFoundError,
  BattleAgoraUnavailableError,
  BattleFeatureDisabledError,
} from "../services/battle.errors.js";
import {
  getBattleSettings,
  updateBattleSettings,
} from "../services/battleSchema.service.js";
import {
  listBattleGiftsCatalog,
  sendBattleGift,
} from "../services/battleGift.service.js";

const mapBattleError = (error, res) => {
  if (error instanceof BattleFeatureDisabledError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (
    error instanceof BattleConflictError ||
    error instanceof BattleUserInCallError
  ) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  const message = error?.message || "Battle request failed";

  if (/not found/i.test(message)) {
    return res.status(404).json({ message });
  }

  if (/not allowed|membership required|not joinable|not live|not active/i.test(message)) {
    return res.status(403).json({ message });
  }

  if (
    /invalid|required|cannot send|only male|only female|already|challenge|at your level/i.test(
      message
    )
  ) {
    return res.status(400).json({ message });
  }

  if (/insufficient gold balance/i.test(message)) {
    return res.status(400).json({ message });
  }

  if (
    error?.name === "SequelizeUniqueConstraintError" ||
    error?.name === "SequelizeValidationError"
  ) {
    return res.status(409).json({
      message: "Could not complete battle request. Please try again.",
    });
  }

  return res.status(500).json({ message });
};

const mapBattleAgoraError = (error, res) => {
  if (error instanceof BattleFeatureDisabledError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (error instanceof BattleAgoraNotFoundError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (error instanceof BattleAgoraAuthorizationError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (error instanceof BattleAgoraUnavailableError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  return mapBattleError(error, res);
};

export const getBattleFeatureStatusHandler = async (req, res) => {
  try {
    const status = await getBattleFeatureStatus();
    return res.json(status);
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const createBattleInviteHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const invite = await createBattleInvite(userId, {
      opponentId: req.body?.opponentId,
      durationSeconds: req.body?.durationSeconds,
    });

    return res.status(201).json(invite);
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const listBattleInvitesHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const invites = await listBattleInvites(userId);
    return res.json({ invites });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const acceptBattleInviteHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const battle = await acceptBattleInvite(userId, req.params.inviteId);
    return res.json({ battle });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const declineBattleInviteHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const result = await declineBattleInvite(userId, req.params.inviteId);
    return res.json(result);
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const cancelBattleInviteHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const result = await cancelBattleInvite(userId, req.params.inviteId);
    return res.json(result);
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const listBattleOpponentsHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const sections = await listBattleOpponents(userId, {
      search: req.query?.search,
      limit: req.query?.limit,
    });

    return res.json({
      opponents: sections.sameLevel,
      sameLevel: sections.sameLevel,
      online: sections.sameLevel,
      recent: sections.recent,
      favorites: sections.favorites,
    });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const listLiveBattlesHandler = async (req, res) => {
  try {
    const battles = await listLiveBattles();
    return res.json({ battles });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const getBattleHandler = async (req, res) => {
  try {
    const userId = req.user?.id;
    const battle = await getBattleDetail(req.params.battleId, userId);
    return res.json({ battle });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const joinBattleFighterHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const battle = await joinBattleAsFighter(userId, req.params.battleId);
    return res.json({ battle });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const joinBattleAudienceHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const battle = await joinBattleAsAudience(userId, req.params.battleId);
    return res.json({ battle });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const leaveBattleAudienceHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const battle = await leaveBattleAudience(userId, req.params.battleId);
    return res.json({ battle });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const getBattleAgoraTokenHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const credentials = await getBattleAgoraCredentials(
      userId,
      req.params.battleId
    );

    return res.json(credentials);
  } catch (error) {
    return mapBattleAgoraError(error, res);
  }
};

export const getBattleGiftsCatalogHandler = async (_req, res) => {
  try {
    await assertBattleFeatureEnabled();
    const gifts = await listBattleGiftsCatalog();
    return res.json({ gifts });
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const sendBattleGiftHandler = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const result = await sendBattleGift({
      senderId: userId,
      battleId: req.params.battleId,
      receiverId: req.body?.receiverId,
      giftId: req.body?.giftId,
      clientRequestId: req.body?.clientRequestId,
    });

    return res.status(201).json(result);
  } catch (error) {
    return mapBattleError(error, res);
  }
};

export const getBattleAdminSettingsHandler = async (_req, res) => {
  try {
    const settings = await getBattleSettings();
    return res.json(settings);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateBattleAdminSettingsHandler = async (req, res) => {
  try {
    const settings = await updateBattleSettings(req.body ?? {});
    return res.json(settings);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

export const listAdminLiveBattlesHandler = async (_req, res) => {
  try {
    const battles = await listAdminLiveBattles();
    return res.json({ battles });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listAdminFinishedBattlesHandler = async (req, res) => {
  try {
    const report = await listAdminFinishedBattles({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
    });
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getAdminBattleViewersHandler = async (req, res) => {
  try {
    const report = await getAdminBattleViewerGifts(req.params.battleId);
    return res.json(report);
  } catch (error) {
    if (/not found/i.test(error?.message || "")) {
      return res.status(404).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

export const deleteAdminBattleHandler = async (req, res) => {
  try {
    const battle = await adminForceCloseBattle(req.params.battleId);
    return res.json({ battle });
  } catch (error) {
    return mapBattleError(error, res);
  }
};
