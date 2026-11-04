-- Rollback for Phase 2 schema. Only run after switching CALL_BILLING_MODE back
-- to `client` and confirming no server-billed call is still active. Dropping
-- call_billing_intervals loses the per-interval audit trail; the debits
-- themselves stay in wallet_transactions.

DROP TABLE IF EXISTS `call_billing_intervals`;
ALTER TABLE `call_histories` DROP COLUMN `billableSeconds`;
ALTER TABLE `call_histories` DROP COLUMN `billingRatePerMinute`;
ALTER TABLE `call_histories` DROP COLUMN `billingMode`;
ALTER TABLE `quick_connect_sessions` DROP COLUMN `billingMode`;
