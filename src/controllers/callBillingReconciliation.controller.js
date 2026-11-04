import { getCallBillingReconciliation } from "../services/callBillingReconciliation.service.js";

export const getCallBillingReconciliationReport = async (req, res) => {
  try {
    const report = await getCallBillingReconciliation({
      from: req.query.from,
      to: req.query.to,
      callerId: req.query.callerId,
      receiverId: req.query.receiverId,
      onlyDiscrepancies: req.query.onlyDiscrepancies !== "false",
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json(report);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
