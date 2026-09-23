import { backfillMaleUserEngagementStats } from "../services/userEngagementBackfill.service.js";

try {
  const result = await backfillMaleUserEngagementStats();
  console.log("Male engagement backfill completed", result);
  process.exit(0);
} catch (error) {
  console.error("Male engagement backfill failed", error);
  process.exit(1);
}
