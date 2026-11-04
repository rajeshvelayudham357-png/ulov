-- ULOV call billing Phase 2 (server-authoritative billing) - additive only.
--
-- The backend applies the same changes on startup through
-- src/services/callBillingSchema.service.js (idempotent). No existing row is
-- modified; NULL billingMode means the phone charged the call (as before).

ALTER TABLE `call_histories` ADD COLUMN `billingMode` VARCHAR(16) NULL;
ALTER TABLE `call_histories` ADD COLUMN `billingRatePerMinute` DECIMAL(10,2) NULL;
ALTER TABLE `call_histories` ADD COLUMN `billableSeconds` INT NULL;

ALTER TABLE `quick_connect_sessions` ADD COLUMN `billingMode` VARCHAR(16) NULL;

CREATE TABLE IF NOT EXISTS `call_billing_intervals` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `callId` INT NOT NULL,
  `intervalIndex` INT NOT NULL,
  `shadow` TINYINT(1) NOT NULL DEFAULT 0,
  `coversFromSecond` INT NOT NULL,
  `coversToSecond` INT NOT NULL,
  `amount` INT NOT NULL,
  `walletTransactionId` INT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_call_interval` (`callId`, `intervalIndex`, `shadow`),
  KEY `idx_cbi_call` (`callId`)
);
