import { QueryTypes } from "sequelize";

import {
  AdminNotify,
  Block,
  Broadcast,
  CallHistory,
  CallRating,
  ChatMessage,
  DeviceToken,
  Earning,
  NotificationRecord,
  SupportMessage,
  SupportTicket,
  PaymentOrder,
  CallGiftRecord,
  AccountDeletionRequest,
  WalletTransaction,
  Wallet,
  Withdraw,
} from "../models/index.js";
import { sequelize } from "../config/database.js";
import { getPublicCallRates } from "./callRate.service.js";
import { ensureFemaleOnlineTimeTables } from "./femaleOnlineTime.service.js";
import { ensureSupportTables } from "./support.service.js";
import { ensureUserSchema } from "./userSchema.service.js";
import { ensurePaymentOrderColumns } from "./payment.service.js";

const safeModelSync = async (model, label) => {
  try {
    await model.sync({ alter: true });
    console.log(`${label} synced`);
  } catch (error) {
    console.log(`${label} alter sync skipped: ${error.message}`);
    await model.sync();
    console.log(`${label} base sync completed`);
  }
};

const tableExists = async (tableName) => {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS tableCount
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT,
    }
  );

  return Number(rows[0]?.tableCount ?? 0) > 0;
};

const ensureEarningsTable = async () => {
  const hasLowercase = await tableExists("earnings");
  const hasUppercase = await tableExists("Earnings");

  if (hasUppercase && !hasLowercase) {
    try {
      await sequelize.query("RENAME TABLE `Earnings` TO `earnings`");
      console.log("Renamed Earnings table to earnings");
    } catch (error) {
      console.log(`Earnings rename skipped: ${error.message}`);
    }
  }

  if (!(await tableExists("earnings"))) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`earnings\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`userId\` INT NOT NULL,
        \`callId\` INT NULL,
        \`coins\` INT DEFAULT 0,
        \`amount\` FLOAT DEFAULT 0,
        \`duration\` INT DEFAULT 0,
        \`status\` ENUM('pending', 'paid') DEFAULT 'pending',
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`unique_earning_per_call\` (\`callId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("earnings table created");
  }

  await safeModelSync(Earning, "Earning");
};

const ensureWithdrawsTable = async () => {
  const hasLowercase = await tableExists("withdraws");
  const hasUppercase = await tableExists("Withdraws");

  if (hasUppercase && !hasLowercase) {
    try {
      await sequelize.query("RENAME TABLE `Withdraws` TO `withdraws`");
      console.log("Renamed Withdraws table to withdraws");
    } catch (error) {
      console.log(`Withdraws rename skipped: ${error.message}`);
    }
  }

  await safeModelSync(Withdraw, "Withdraw");
};

export const runDatabaseMigrations = async () => {
  console.log("Running database migrations...");

  await sequelize.authenticate();
  console.log("Database connection OK");

  console.log("Ensuring user schema...");
  await ensureUserSchema({ force: true });
  console.log("User schema ready");

  console.log("Ensuring support tables...");
  await ensureSupportTables();
  console.log("Support tables ready");

  console.log("Ensuring female online time tables...");
  await ensureFemaleOnlineTimeTables();
  console.log("Female online time tables ready");

  console.log("Ensuring payment order schema...");
  await ensurePaymentOrderColumns();
  console.log("Payment order schema ready");

  console.log("Loading call rates...");
  await getPublicCallRates();
  console.log("Call rates ready");

  console.log("Ensuring core analytics tables...");
  await ensureEarningsTable();
  await ensureWithdrawsTable();
  await safeModelSync(Wallet, "Wallet");
  await safeModelSync(CallHistory, "CallHistory");
  await safeModelSync(PaymentOrder, "PaymentOrder");
  await safeModelSync(Broadcast, "Broadcast");
  console.log("Core analytics tables ready");

  await safeModelSync(DeviceToken, "DeviceToken");
  await safeModelSync(NotificationRecord, "NotificationRecord");
  await safeModelSync(AdminNotify, "AdminNotify");
  await safeModelSync(ChatMessage, "ChatMessage");
  await safeModelSync(CallRating, "CallRating");
  await safeModelSync(Block, "Block");
  await safeModelSync(CallGiftRecord, "CallGiftRecord");
  await safeModelSync(AccountDeletionRequest, "AccountDeletionRequest");
  await safeModelSync(WalletTransaction, "WalletTransaction");

  console.log("Database migrations completed");
};
