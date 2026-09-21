import { getMaleWalletCoinsReport } from "../services/maleWalletCoins.service.js";

export const getMaleWalletCoins = async (req, res) => {
  try {
    const onlyWithBalance =
      req.query.onlyWithBalance === "true" ||
      req.query.onlyWithBalance === "1" ||
      req.query.balanceFilter === "positive";

    const report = await getMaleWalletCoinsReport({
      search: req.query.search || req.query.q || "",
      minBalance: req.query.minBalance,
      onlyWithBalance,
      balanceFilter: req.query.balanceFilter || "all",
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.json(report);
  } catch (error) {
    console.log("MALE WALLET COINS REPORT ERROR", error.message);
    return res.status(500).json({
      message: error.message,
    });
  }
};
