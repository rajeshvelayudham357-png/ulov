import { getExpectedPayoutReport } from "../services/expectedPayout.service.js";

export const getExpectedPayouts = async (req, res) => {
  try {
    const creatorId = req.query.creatorId || req.query.userId || null;
    const search = req.query.search || req.query.q || "";

    const report = await getExpectedPayoutReport({
      creatorId,
      search,
    });

    return res.json(report);
  } catch (error) {
    console.log("EXPECTED PAYOUT REPORT ERROR", error.message);
    return res.status(500).json({
      message: error.message,
    });
  }
};
