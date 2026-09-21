import { User } from "../models/index.js";
import {
  buildProfileFramesCatalog,
  equipProfileFrame,
  ensureProfileFrameSchema,
  purchaseProfileFrame,
} from "../services/profileFrame.service.js";

export const getProfileFramesCatalog = async (req, res) => {
  try {
    await ensureProfileFrameSchema();

    const userId = Number(req.params.userId || req.query.userId || req.user?.id);

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ message: "User id is required" });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(await buildProfileFramesCatalog(user));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const purchaseProfileFrameHandler = async (req, res) => {
  try {
    const userId = Number(req.body?.userId || req.params.userId || req.user?.id);
    const result = await purchaseProfileFrame(userId, req.body?.frameId);

    return res.json({
      success: true,
      message: "Frame purchased successfully",
      ...result,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

export const equipProfileFrameHandler = async (req, res) => {
  try {
    const userId = Number(req.body?.userId || req.params.userId || req.user?.id);
    const result = await equipProfileFrame(userId, req.body?.frameId ?? null);

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};
