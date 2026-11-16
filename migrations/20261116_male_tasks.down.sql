-- Destructive rollback for male task tables. Do not run in production without approval.
DROP TABLE IF EXISTS male_task_progress;
DROP TABLE IF EXISTS male_task_claims;
DROP TABLE IF EXISTS male_task_streaks;
DROP TABLE IF EXISTS male_master_tasks;
