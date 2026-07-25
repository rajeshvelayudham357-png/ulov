import {
  AdminNotify,
  Block,
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
} from "../models/index.js";
import { sequelize } from "../config/database.js";
import { getPublicCallRates } from "./callRate.service.js";
import { ensureFemaleOnlineTimeTables } from "./femaleOnlineTime.service.js";
import { ensureSupportTables } from "./support.service.js";
import { ensureUserSchema } from "./userSchema.service.js";

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

  console.log("Loading call rates...");
  await getPublicCallRates();
  console.log("Call rates ready");

  await safeModelSync(DeviceToken, "DeviceToken");
  await safeModelSync(NotificationRecord, "NotificationRecord");
  await safeModelSync(AdminNotify, "AdminNotify");
  await safeModelSync(ChatMessage, "ChatMessage");
  await safeModelSync(CallRating, "CallRating");
  await safeModelSync(Block, "Block");
  await safeModelSync(Earning, "Earning");
  await safeModelSync(PaymentOrder, "PaymentOrder");
  await safeModelSync(CallGiftRecord, "CallGiftRecord");
  await safeModelSync(AccountDeletionRequest, "AccountDeletionRequest");
  await safeModelSync(WalletTransaction, "WalletTransaction");

  console.log("Database migrations completed");
};
