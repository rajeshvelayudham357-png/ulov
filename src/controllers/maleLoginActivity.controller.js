import { ensureUserOnlineLogSchema } from "../services/userOnlineLog.service.js";
import { ensureUserSchema } from "../services/userSchema.service.js";
import { getMaleLoginActivityReport } from "../services/maleLoginActivity.service.js";

export const listMaleLoginActivity = async (req, res) => {
  try {
    await Promise.all([ensureUserSchema(), ensureUserOnlineLogSchema()]);

    const search = String(req.query.search || "").trim();
    const inactiveDays = Math.max(0, Number(req.query.inactiveDays) || 0);

    const report = await getMaleLoginActivityReport({
      search,
      inactiveDays,
    });

    return res.json(report);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
