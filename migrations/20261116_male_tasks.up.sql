-- Male daily / weekly task system (additive).
-- Runtime ensureMaleTaskSchema() applies the same DDL on startup.

CREATE TABLE IF NOT EXISTS male_master_tasks (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  icon VARCHAR(40) NULL,
  rewardCoins INT NOT NULL DEFAULT 0,
  cadence VARCHAR(20) NOT NULL DEFAULT 'daily',
  requirements JSON NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  sortOrder INT NOT NULL DEFAULT 0,
  startAt DATETIME NULL,
  endAt DATETIME NULL,
  deletedAt DATETIME NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS male_task_claims (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId BIGINT NOT NULL,
  taskId VARCHAR(64) NOT NULL,
  claimKey VARCHAR(64) NOT NULL,
  rewardCoins INT NOT NULL DEFAULT 0,
  walletTransactionId BIGINT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_male_task_claim (userId, taskId, claimKey),
  KEY idx_male_task_claims_user (userId),
  KEY idx_male_task_claims_task (taskId),
  KEY idx_male_task_claims_created (createdAt)
);

CREATE TABLE IF NOT EXISTS male_task_progress (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId BIGINT NOT NULL,
  taskId VARCHAR(64) NOT NULL,
  progressDate VARCHAR(32) NOT NULL,
  currentProgress INT NOT NULL DEFAULT 0,
  targetProgress INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  completedAt DATETIME NULL,
  claimedAt DATETIME NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_male_task_progress (userId, taskId, progressDate),
  KEY idx_male_task_progress_user_date (userId, progressDate)
);

CREATE TABLE IF NOT EXISTS male_task_streaks (
  userId BIGINT NOT NULL PRIMARY KEY,
  currentStreak INT NOT NULL DEFAULT 0,
  lastQualifyingDate VARCHAR(10) NULL,
  cycleStartDate VARCHAR(10) NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
