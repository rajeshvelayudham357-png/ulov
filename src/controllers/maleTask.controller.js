import {
  claimMaleTaskReward,
  getMaleTaskHistory,
  getMaleTaskOverview,
  getMaleTaskSummary,
} from "../services/maleTask.service.js";
import { maybeNotifyMaleTaskOverview } from "../services/maleTaskNotification.service.js";

export const getMaleTasks = async (req, res) => {
  try {
    const { userId } = req.params;
    const overview = await getMaleTaskOverview(userId);

    // Fire-and-forget reminders / completion notices
    maybeNotifyMaleTaskOverview(userId, overview).catch(() => {});

    return res.json(overview);
  } catch (error) {
    const message = error?.message ?? "Unable to load male tasks";
    const status = message.includes("male users only")
      ? 403
      : message.includes("Valid user")
        ? 400
        : 500;
    return res.status(status).json({ message });
  }
};

export const getMaleTasksSummary = async (req, res) => {
  try {
    const { userId } = req.params;
    const summary = await getMaleTaskSummary(userId);
    return res.json(summary);
  } catch (error) {
    const message = error?.message ?? "Unable to load male task summary";
    const status = message.includes("male users only")
      ? 403
      : message.includes("Valid user")
        ? 400
        : 500;
    return res.status(status).json({ message });
  }
};

export const getMaleTasksHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const history = await getMaleTaskHistory(userId, {
      limit: req.query.limit,
    });
    return res.json(history);
  } catch (error) {
    const message = error?.message ?? "Unable to load male task history";
    const status = message.includes("male users only")
      ? 403
      : message.includes("Valid user")
        ? 400
        : 500;
    return res.status(status).json({ message });
  }
};

export const claimMaleTask = async (req, res) => {
  try {
    const { userId } = req.params;
    const { taskId } = req.body || {};

    if (!taskId) {
      return res.status(400).json({ message: "taskId is required" });
    }

    const result = await claimMaleTaskReward(userId, taskId);
    return res.json(result);
  } catch (error) {
    const message = error?.message ?? "Unable to claim task reward";
    const status = message.includes("already claimed")
      ? 409
      : message.includes("not completed")
        ? 400
        : message.includes("not found") || message.includes("not available")
          ? 404
          : message.includes("male users only")
            ? 403
            : 500;

    return res.status(status).json({ message });
  }
};
