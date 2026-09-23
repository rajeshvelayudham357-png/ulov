import { cleanUserEngagementBackfillEpochArtifacts } from "../services/userEngagementEpochCleanup.service.js";

try {
  const result = await cleanUserEngagementBackfillEpochArtifacts();
  console.log("Engagement epoch cleanup completed", result);
  process.exit(0);
} catch (error) {
  console.error("Engagement epoch cleanup failed", error);
  process.exit(1);
}
