import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";

let schemaReady = false;

const columnExists = async (tableName, columnName) => {
  const rows = await sequelize.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = :tableName
     AND COLUMN_NAME = :columnName
     LIMIT 1`,
    {
      replacements: { tableName, columnName },
      type: QueryTypes.SELECT,
    }
  );
  return rows.length > 0;
};

const ensureColumn = async (tableName, columnName, definition) => {
  if (await columnExists(tableName, columnName)) {
    return;
  }
  await sequelize.query(
    `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
  );
};

export const ensurePaymentDatabaseSchemas = async () => {
  if (schemaReady) return;

  try {
    // 1. Ensure admin_payment_settings table & columns
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS admin_payment_settings (
        id TINYINT NOT NULL PRIMARY KEY,
        activeGateway VARCHAR(30) NOT NULL DEFAULT 'cashfree',
        cashfreeClientId TEXT NULL,
        cashfreeClientSecret TEXT NULL,
        cashfreeEnv VARCHAR(20) NOT NULL DEFAULT 'sandbox',
        razorpayKeyId TEXT NULL,
        razorpayKeySecret TEXT NULL,
        razorpayWebhookSecret TEXT NULL,
        razorpayEnv VARCHAR(20) NOT NULL DEFAULT 'test',
        googlePlayEnabled TINYINT(1) NOT NULL DEFAULT 1,
        googlePlayEnv VARCHAR(20) NOT NULL DEFAULT 'test',
        googlePlayPackageName VARCHAR(255) NULL,
        googlePlayServiceAccountEmail VARCHAR(255) NULL,
        googlePlayProjectId VARCHAR(255) NULL,
        googlePlayProjectNumber VARCHAR(255) NULL,
        googlePlayApiEnabled TINYINT(1) NOT NULL DEFAULT 0,
        googlePlayNotes TEXT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`
    );

    await ensureColumn("admin_payment_settings", "googlePlayEnabled", "TINYINT(1) NOT NULL DEFAULT 1");
    await ensureColumn("admin_payment_settings", "googlePlayEnv", "VARCHAR(20) NOT NULL DEFAULT 'test'");
    await ensureColumn("admin_payment_settings", "googlePlayPackageName", "VARCHAR(255) NULL");
    await ensureColumn("admin_payment_settings", "googlePlayServiceAccountEmail", "VARCHAR(255) NULL");
    await ensureColumn("admin_payment_settings", "googlePlayProjectId", "VARCHAR(255) NULL");
    await ensureColumn("admin_payment_settings", "googlePlayProjectNumber", "VARCHAR(255) NULL");
    await ensureColumn("admin_payment_settings", "googlePlayApiEnabled", "TINYINT(1) NOT NULL DEFAULT 0");
    await ensureColumn("admin_payment_settings", "googlePlayNotes", "TEXT NULL");

    // PayU payment settings columns
    await ensureColumn("admin_payment_settings", "payuMerchantKey", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "payuMerchantSalt", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "payuMerchantId", "VARCHAR(100) NULL");
    await ensureColumn("admin_payment_settings", "payuEnv", "VARCHAR(20) NOT NULL DEFAULT 'test'");
    await ensureColumn("admin_payment_settings", "payuWebhookSecret", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "payuSuccessUrl", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "payuFailureUrl", "TEXT NULL");

    // PayU payment_orders columns
    await ensureColumn("payment_orders", "payuTxnId", "VARCHAR(120) NULL");
    await ensureColumn("payment_orders", "payuPaymentId", "VARCHAR(120) NULL");
    await ensureColumn("payment_orders", "payuStatus", "VARCHAR(50) NULL");
    await ensureColumn("payment_orders", "payuHash", "VARCHAR(255) NULL");

    // PhonePe payment settings columns (PhonePe Standard Checkout OAuth API)
    await ensureColumn("admin_payment_settings", "phonepeMerchantId", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "phonepeClientId", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "phonepeClientSecret", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "phonepeClientVersion", "VARCHAR(20) NOT NULL DEFAULT '1'");
    await ensureColumn("admin_payment_settings", "phonepeEnv", "VARCHAR(20) NOT NULL DEFAULT 'sandbox'");
    await ensureColumn("admin_payment_settings", "phonepeWebhookSecret", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "phonepeSuccessUrl", "TEXT NULL");
    await ensureColumn("admin_payment_settings", "phonepeFailureUrl", "TEXT NULL");

    // PhonePe payment_orders columns
    await ensureColumn("payment_orders", "phonepeOrderToken", "VARCHAR(512) NULL");
    await ensureColumn("payment_orders", "phonepePaymentId", "VARCHAR(120) NULL");
    await ensureColumn("payment_orders", "phonepeMerchantTransactionId", "VARCHAR(120) NULL");
    await ensureColumn("payment_orders", "phonepeMerchantOrderId", "VARCHAR(120) NULL");
    await ensureColumn("payment_orders", "phonepeStatus", "VARCHAR(50) NULL");
    await ensureColumn("payment_orders", "phonepeRedirectUrl", "TEXT NULL");

    // 2. Ensure payment_products table
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS payment_products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        provider VARCHAR(30) NOT NULL,
        platform VARCHAR(20) NOT NULL DEFAULT 'android',
        productId VARCHAR(100) NOT NULL,
        coins INT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        displayOrder INT NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_provider_platform_product (provider, platform, productId)
      )`
    );

    // Seed default Google Play products matching mobile app packages
    const defaultProducts = [
      { provider: "google_play", platform: "android", productId: "coins_40", coins: 40, price: 19.00, displayOrder: 1 },
      { provider: "google_play", platform: "android", productId: "coins_80", coins: 80, price: 39.00, displayOrder: 2 },
      { provider: "google_play", platform: "android", productId: "coins_160", coins: 160, price: 69.00, displayOrder: 3 },
      { provider: "google_play", platform: "android", productId: "coins_320", coins: 320, price: 129.00, displayOrder: 4 },
      { provider: "google_play", platform: "android", productId: "coins_640", coins: 640, price: 249.00, displayOrder: 5 },
      { provider: "google_play", platform: "android", productId: "coins_1040", coins: 1040, price: 389.00, displayOrder: 6 },
      { provider: "google_play", platform: "android", productId: "coins_2100", coins: 2100, price: 699.00, displayOrder: 7 },
      { provider: "google_play", platform: "android", productId: "coins_5000", coins: 5000, price: 1499.00, displayOrder: 8 },
      { provider: "google_play", platform: "android", productId: "coins_100", coins: 100, price: 99.00, displayOrder: 9 },
      { provider: "google_play", platform: "android", productId: "coins_250", coins: 250, price: 249.00, displayOrder: 10 },
      { provider: "google_play", platform: "android", productId: "coins_500", coins: 500, price: 499.00, displayOrder: 11 },
      { provider: "google_play", platform: "android", productId: "coins_1000", coins: 1000, price: 999.00, displayOrder: 12 },
      { provider: "google_play", platform: "android", productId: "coins_2500", coins: 2500, price: 2499.00, displayOrder: 13 },
    ];

    for (const p of defaultProducts) {
      await sequelize.query(
        `INSERT IGNORE INTO payment_products (provider, platform, productId, coins, price, displayOrder)
         VALUES (:provider, :platform, :productId, :coins, :price, :displayOrder)`,
        { replacements: p }
      );
    }

    // 3. Ensure payment_orders columns & indexes
    try {
      await sequelize.query(`ALTER TABLE payment_orders MODIFY COLUMN packageId INT NULL`);
    } catch (_err) {}
    await ensureColumn("payment_orders", "paymentProvider", "VARCHAR(30) NULL");
    await ensureColumn("payment_orders", "platform", "VARCHAR(20) NULL DEFAULT 'android'");
    await ensureColumn("payment_orders", "purchaseToken", "VARCHAR(512) NULL");
    await ensureColumn("payment_orders", "googleOrderId", "VARCHAR(255) NULL");
    await ensureColumn("payment_orders", "productId", "VARCHAR(100) NULL");
    await ensureColumn("payment_orders", "purchaseState", "VARCHAR(50) NULL");

    // Try adding unique index on purchaseToken
    try {
      await sequelize.query(`ALTER TABLE payment_orders ADD UNIQUE INDEX uq_purchase_token (purchaseToken(255))`);
    } catch (_err) {
      // Index may already exist
    }

    // 4. Ensure payment_audit_logs table
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS payment_audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        userId INT NULL,
        provider VARCHAR(30) NOT NULL,
        action VARCHAR(50) NOT NULL,
        requestData LONGTEXT NULL,
        responseData LONGTEXT NULL,
        status VARCHAR(50) NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );

    schemaReady = true;
  } catch (error) {
    console.error("Payment Database Schema Setup Error:", error);
  }
};
