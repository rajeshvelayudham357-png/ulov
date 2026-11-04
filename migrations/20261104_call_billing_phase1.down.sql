-- Rollback for 20261104_call_billing_phase1.up.sql.
--
-- Only run after the Phase 1 code has been rolled back; the new code reads
-- these columns. Dropping them discards settlement timestamps and the
-- per-call collected-coin snapshot, but no wallet, transaction or earning row.

DROP INDEX `idx_wt_reference` ON `wallet_transactions`;

ALTER TABLE `call_histories` DROP COLUMN `endReason`;
ALTER TABLE `call_histories` DROP COLUMN `collectedCoins`;
ALTER TABLE `call_histories` DROP COLUMN `settledAt`;
ALTER TABLE `call_histories` DROP COLUMN `endedAt`;
ALTER TABLE `call_histories` DROP COLUMN `acceptedAt`;
