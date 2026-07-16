import {
  listCallGifts,
  sendCallGift as sendCallGiftService,
  fetchFemaleReceivedGifts as fetchFemaleReceivedGiftsService,
} from "../services/callGift.service.js";
import { getGiftSettings } from "../services/giftSettings.service.js";
import { getBlockedPeerIds } from "../services/block.service.js";
import { User } from "../models/index.js";

export const getCallGifts = async (req, res) => {
  try {
    const settings = await getGiftSettings();

    return res.json({
      gifts: await listCallGifts(),
      femaleEarnPercent: settings.femaleEarnPercent,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const sendCallGift = async (req, res) => {
  try {
    const {
      senderId,
      receiverId,
      giftId,
      callSessionId,
    } = req.body;

    const result = await sendCallGiftService({
      senderId,
      receiverId,
      giftId,
      callSessionId,
    });

    return res.json(result);
  } catch (error) {
    const message = error.message || "Unable to send gift";
    const status =
      message === "Insufficient gold balance" ||
      message === "Invalid gift" ||
      message === "Unable to send gift to this user"
        ? 400
        : 500;

    return res.status(status).json({
      message,
    });
  }
};

export const getFemaleReceivedGifts = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number(req.query.limit) || 20)
    );

    const female = await User.findByPk(userId);

    if (!female) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const blockedIds = await getBlockedPeerIds(userId);

    const data = await fetchFemaleReceivedGiftsService({
      receiverId: userId,
      page,
      limit,
      excludeUserIds: [...blockedIds],
    });

    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
