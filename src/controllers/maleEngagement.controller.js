import { getMaleEngagementDashboard } from "../services/adminMaleEngagement.service.js";

export const listMaleEngagement = async (req, res) => {
  try {
    const report = await getMaleEngagementDashboard({
      search: req.query.search || req.query.q || "",
      status: req.query.status || "all",
      from: req.query.from || "",
      to: req.query.to || "",
      hasAppOpen: req.query.hasAppOpen ?? "",
      hasSession: req.query.hasSession ?? "",
      hasChat: req.query.hasChat ?? "",
      hasCall: req.query.hasCall ?? "",
      hasRecharge: req.query.hasRecharge ?? "",
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.json(report);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        message: error.message,
      });
    }

    console.log("MALE ENGAGEMENT DASHBOARD ERROR", error.message);
    return res.status(500).json({
      message: error.message,
    });
  }
};
