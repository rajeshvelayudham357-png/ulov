import { getDailyPayoutReport } from "../services/dailyPayout.service.js";

export const getDailyPayout = async (req, res) => {
  try {
    const report = await getDailyPayoutReport({
      period: req.query.period,
      startDate: req.query.startDate || req.query.from,
      endDate: req.query.endDate || req.query.to,
    });

    return res.json(report);
  } catch (error) {
    console.log("DAILY PAYOUT REPORT ERROR", error.message);
    return res.status(500).json({
      message: error.message,
    });
  }
};
