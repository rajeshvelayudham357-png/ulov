import { getDailyRevenueReport } from "../services/dailyRevenue.service.js";

export const getDailyRevenue = async (req, res) => {
  try {
    const report = await getDailyRevenueReport({
      period: req.query.period,
      startDate: req.query.startDate || req.query.from,
      endDate: req.query.endDate || req.query.to,
    });

    return res.json(report);
  } catch (error) {
    console.log("DAILY REVENUE REPORT ERROR", error.message);
    return res.status(500).json({
      message: error.message,
    });
  }
};
