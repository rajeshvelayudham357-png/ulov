import {
  askAssistant,
  escalateToSupport,
  getAssistantWelcome,
} from "../services/supportAssistant.service.js";

const sendError = (res, error, fallback) =>
  res.status(error?.statusCode || 500).json({
    message: error?.message || fallback,
    ...(error?.availableAt ? { availableAt: error.availableAt } : {}),
  });

export const getSupportAssistant = async (req, res) => {
  try {
    return res.json(
      await getAssistantWelcome({ userId: Number(req.user?.id), language: req.query.lang })
    );
  } catch (error) {
    return sendError(res, error, "Assistant unavailable");
  }
};

export const askSupportAssistant = async (req, res) => {
  try {
    return res.json(
      await askAssistant({
        userId: Number(req.user?.id),
        topic: req.body?.topic,
        intent: req.body?.intent,
        message: req.body?.message,
        language: req.body?.lang,
      })
    );
  } catch (error) {
    return sendError(res, error, "Assistant unavailable");
  }
};

export const escalateSupportAssistant = async (req, res) => {
  try {
    return res.json(
      await escalateToSupport({
        userId: Number(req.user?.id),
        topic: req.body?.topic,
        intent: req.body?.intent,
        details: req.body?.details,
        language: req.body?.lang,
      })
    );
  } catch (error) {
    return sendError(res, error, "Could not create a ticket");
  }
};
