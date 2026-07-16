import { User } from "../models/index.js";
import {
  getSpinSettings,
  getSpinStatus,
  getSpinWheelPublicConfig,
  getMaleUserSpinSettings,
  performSpin,
  updateMaleUserSpinPercentage,
  updateSpinSettings,
  ensureSpinWheelEnabled,
} from "../services/spinWheel.service.js";

const ensureMaleUser = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: ["id", "gender"],
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (String(user.gender) !== "Male") {
    throw new Error("Spin wheel is available for male users only");
  }

  return user;
};

export const getSpinWheelConfig = async (req, res) => {
  try {
    const config = await getSpinWheelPublicConfig();

    return res.json(config);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getSpinWheelStatus = async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isFinite(userId)) {
      return res.status(400).json({
        message: "Invalid user id",
      });
    }

    await ensureSpinWheelEnabled();
    await ensureMaleUser(userId);

    const status = await getSpinStatus(userId);

    return res.json(status);
  } catch (error) {
    const statusCode =
      error.message === "Spin wheel is currently disabled"
        ? 403
        : 500;

    return res.status(statusCode).json({
      message: error.message,
    });
  }
};

export const spinWheelPlay = async (req, res) => {
  try {
    const userId = Number(req.body.userId);

    if (!Number.isFinite(userId)) {
      return res.status(400).json({
        message: "Invalid user id",
      });
    }

    await ensureMaleUser(userId);
    await ensureSpinWheelEnabled();

    const status = await getSpinStatus(userId);

    if (!status.canSpin) {
      return res.status(400).json({
        message: status.freeSpinAvailable
          ? "Unable to spin right now"
          : "Not enough gold for another spin",
      });
    }

    const result = await performSpin(userId);

    return res.json({
      message:
        result.coinsWon > 0
          ? `You won ${result.coinsWon} coins!`
          : result.prize.label,
      ...result,
    });
  } catch (error) {
    const statusCode =
      error.message === "Low balance" ||
      error.message === "Spin wheel is currently disabled"
        ? 400
        : 500;

    return res.status(statusCode).json({
      message: error.message,
    });
  }
};

export const getSpinWheelAdminSettings = async (req, res) => {
  try {
    const settings = await getSpinSettings();

    return res.json(settings);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateSpinWheelAdminSettings = async (req, res) => {
  try {
    const settings = await updateSpinSettings({
      enabled: req.body.enabled,
      winningPercentage: req.body.winningPercentage,
      spinCost: req.body.spinCost,
      freeSpinsPerDay: req.body.freeSpinsPerDay,
    });

    return res.json({
      message: "Spin wheel settings updated",
      settings,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getMaleUserSpinWheelSettings = async (req, res) => {
  try {
    const users = await getMaleUserSpinSettings();

    return res.json(users);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateMaleUserSpinWheelSettings = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!Number.isFinite(userId)) {
      return res.status(400).json({
        message: "Invalid user id",
      });
    }

    const user = await updateMaleUserSpinPercentage(
      userId,
      req.body.winningPercentage
    );

    return res.json({
      message: "Male user spin settings updated",
      user,
    });
  } catch (error) {
    const statusCode =
      error.message === "User not found" ||
      error.message ===
        "Spin wheel overrides are for male users only"
        ? 400
        : 500;

    return res.status(statusCode).json({
      message: error.message,
    });
  }
};
