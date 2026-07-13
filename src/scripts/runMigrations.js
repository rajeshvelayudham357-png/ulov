import { runDatabaseMigrations } from "../services/databaseMigration.service.js";

try {
  await runDatabaseMigrations();
  console.log("Migration script finished successfully");
  process.exit(0);
} catch (error) {
  console.error("Migration script failed", error);
  process.exit(1);
}
