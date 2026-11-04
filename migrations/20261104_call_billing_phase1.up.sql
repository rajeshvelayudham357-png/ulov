-- ULOV call billing Phase 1 (P0 security fixes) - additive only.
--
-- The backend applies the same changes on startup through
-- src/services/callBillingSchema.service.js (idempotent). Run this file
-- manually only if you prefer to migrate before deploying the code.
--
-- No existing row is modified. NULL in the new columns means the call was
-- settled before Phase 1.

ALTER TABLE `call_histories` ADD COLUMN `acceptedAt` DATETIME NULL;
ALTER TABLE `call_histories` ADD COLUMN `endedAt` DATETIME NULL;
ALTER TABLE `call_histories` ADD COLUMN `settledAt` DATETIME NULL;
ALTER TABLE `call_histories` ADD COLUMN `collectedCoins` INT NULL;
ALTER TABLE `call_histories` ADD COLUMN `endReason` VARCHAR(40) NULL;

-- Speeds up "coins collected for this call" lookups.
CREATE INDEX `idx_wt_reference` ON `wallet_transactions` (`referenceType`, `referenceId`);
