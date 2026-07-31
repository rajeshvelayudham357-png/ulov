import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database.js";
import { PaymentOrder, Wallet, WalletTransaction } from "../models/index.js";
import { PaymentProviderFactory } from "./payment/PaymentProviderFactory.js";
import { ensurePaymentDatabaseSchemas } from "./paymentSchema.service.js";
import { GOLD_PACKAGES } from "../constants/goldPackages.js";

// Helper for socket emission if socket server instance is available
let ioInstance = null;
export const setSocketInstance = (io) => {
  ioInstance = io;
};

const auditLog = async ({ userId, provider = "google_play", action, requestData, responseData, status }) => {
  try {
    await ensurePaymentDatabaseSchemas();
    await sequelize.query(
      `INSERT INTO payment_audit_logs (userId, provider, action, requestData, responseData, status)
       VALUES (:userId, :provider, :action, :requestData, :responseData, :status)`,
      {
        replacements: {
          userId: userId || null,
          provider,
          action,
          requestData: JSON.stringify(requestData || {}),
          responseData: JSON.stringify(responseData || {}),
          status,
        },
      }
    );
  } catch (err) {
    console.error("Failed to write payment audit log:", err);
  }
};

export const getPaymentProducts = async (provider = "google_play", platform = "android") => {
  await ensurePaymentDatabaseSchemas();

  const rows = await sequelize.query(
    `SELECT id, provider, platform, productId, coins, price, currency, enabled, displayOrder
     FROM payment_products
     WHERE provider = :provider AND platform = :platform AND enabled = 1
     ORDER BY displayOrder ASC, price ASC`,
    {
      replacements: { provider, platform },
      type: QueryTypes.SELECT,
    }
  );

  return rows;
};

export const verifyAndCreditGooglePlayPurchase = async ({ productId, purchaseToken, userId, packageName }) => {
  await ensurePaymentDatabaseSchemas();

  const requestPayload = { productId, purchaseToken, userId, packageName };
  await auditLog({ userId, action: "VERIFY_ATTEMPT", requestData: requestPayload, status: "pending" });

  if (!productId || !purchaseToken || !userId) {
    const errorResponse = { message: "Missing required fields (productId, purchaseToken, userId)" };
    await auditLog({ userId, action: "VERIFY_FAILED", requestData: requestPayload, responseData: errorResponse, status: "failed" });
    return { success: false, status: "failed", message: errorResponse.message };
  }

  // 1. Check idempotency / duplicate purchase token
  const existingOrders = await sequelize.query(
    `SELECT id, status, coins, amount, purchaseToken FROM payment_orders WHERE purchaseToken = :purchaseToken LIMIT 1`,
    {
      replacements: { purchaseToken },
      type: QueryTypes.SELECT,
    }
  );

  if (existingOrders.length > 0) {
    const existingOrder = existingOrders[0];
    if (existingOrder.status === "credited" || existingOrder.status === "PAID" || existingOrder.status === "SUCCESS") {
      const wallet = await Wallet.findOne({ where: { userId } });
      const duplicateResponse = {
        success: true,
        status: "already_credited",
        orderId: String(existingOrder.id),
        coins: existingOrder.coins,
        amount: existingOrder.amount,
        credited: false,
        wallet: { balance: wallet?.balance || 0 },
      };

      await auditLog({ userId, action: "DUPLICATE_TOKEN", requestData: requestPayload, responseData: duplicateResponse, status: "duplicate" });
      return duplicateResponse;
    }
  }

  // 2. Resolve Product from DB (never trust client coins)
  let productRows = await sequelize.query(
    `SELECT * FROM payment_products WHERE productId = :productId AND provider = 'google_play' LIMIT 1`,
    {
      replacements: { productId },
      type: QueryTypes.SELECT,
    }
  );

  if (productRows.length === 0) {
    // Dynamic fallback for packages matching coins_{N} or GOLD_PACKAGES
    let parsedCoins = 0;
    let parsedPrice = 0;

    const coinMatch = productId.match(/^coins_(\d+)$/);
    if (coinMatch) {
      parsedCoins = Number(coinMatch[1]);
      const pkg = GOLD_PACKAGES.find((g) => Number(g.coins) === parsedCoins);
      parsedPrice = pkg ? Number(pkg.price) : parsedCoins;
    }

    if (parsedCoins > 0) {
      try {
        await sequelize.query(
          `INSERT IGNORE INTO payment_products (provider, platform, productId, coins, price, displayOrder)
           VALUES ('google_play', 'android', :productId, :coins, :price, 99)`,
          {
            replacements: { productId, coins: parsedCoins, price: parsedPrice },
          }
        );

        productRows = await sequelize.query(
          `SELECT * FROM payment_products WHERE productId = :productId AND provider = 'google_play' LIMIT 1`,
          {
            replacements: { productId },
            type: QueryTypes.SELECT,
          }
        );
      } catch (_e) {
        // Fallback object
      }
    }

    if (productRows.length === 0 && parsedCoins > 0) {
      productRows = [{ coins: parsedCoins, price: parsedPrice, currency: "INR", productId }];
    }
  }

  if (productRows.length === 0) {
    const errorResponse = { message: `Product ${productId} not found in database configuration` };
    await auditLog({ userId, action: "VERIFY_FAILED", requestData: requestPayload, responseData: errorResponse, status: "failed" });
    return { success: false, status: "failed", message: errorResponse.message };
  }

  const productConfig = productRows[0];
  const coinsToCredit = Number(productConfig.coins);
  const amountToCharge = Number(productConfig.price);

  // 3. Verify purchase with Google Play Developer API
  const providerInstance = PaymentProviderFactory.getProvider("google_play");
  const verificationResult = await providerInstance.verifyPurchase({ packageName, productId, purchaseToken });

  if (!verificationResult.verified) {
    const errorResponse = { message: verificationResult.error || "Google Play verification failed", verificationResult };
    await auditLog({ userId, action: "VERIFY_FAILED", requestData: requestPayload, responseData: errorResponse, status: "failed" });
    return { success: false, status: "failed", message: errorResponse.message };
  }

  // 4. Acknowledge Purchase with Google
  await providerInstance.acknowledgePurchase({ packageName, productId, purchaseToken });

  // 5. Database Transaction for Wallet & Order
  const transaction = await sequelize.transaction();

  try {
    // Upsert payment order
    const orderId = `GPA-${Date.now()}-${userId}`;

    const [order] = await PaymentOrder.findOrCreate({
      where: { purchaseToken },
      defaults: {
        orderId,
        userId,
        packageId: productConfig.id || null,
        amount: amountToCharge,
        coins: coinsToCredit,
        currency: productConfig.currency || "INR",
        status: "credited",
        paymentProvider: "google_play",
        platform: "android",
        purchaseToken,
        googleOrderId: verificationResult.orderId || orderId,
        productId,
        purchaseState: String(verificationResult.purchaseState ?? 0),
        rawResponse: JSON.stringify(verificationResult),
      },
      transaction,
    });

    if (order.status !== "credited") {
      await order.update({
        status: "credited",
        paymentProvider: "google_play",
        googleOrderId: verificationResult.orderId || order.googleOrderId,
        purchaseState: String(verificationResult.purchaseState ?? 0),
      }, { transaction });
    }

    // Credit Wallet & Update Effective Coin Value
    let wallet = await Wallet.findOne({ where: { userId }, transaction });
    if (!wallet) {
      wallet = await Wallet.create({ userId, balance: coinsToCredit }, { transaction });
    } else {
      await wallet.update({ balance: wallet.balance + coinsToCredit }, { transaction });
    }

    if (coinsToCredit > 0 && productConfig.price > 0) {
      const effectiveCoinValue = Number((Number(productConfig.price) / coinsToCredit).toFixed(5));
      try {
        await User.update({ effectiveCoinValue }, { where: { id: userId }, transaction });
      } catch (_e) {}
    }

    // Create Wallet Transaction
    await WalletTransaction.create({
      userId,
      amount: coinsToCredit,
      type: "credit",
      description: `Google Play Recharge: ${productConfig.productId} (${coinsToCredit} coins)`,
      referenceId: String(order.id),
      referenceType: "recharge",
    }, { transaction });

    await transaction.commit();

    const successResponse = {
      success: true,
      status: "credited",
      orderId: String(order.id),
      googleOrderId: verificationResult.orderId,
      productId,
      coins: coinsToCredit,
      amount: amountToCharge,
      credited: true,
      wallet: { balance: wallet.balance },
    };

    await auditLog({ userId, action: "CREDIT_SUCCESS", requestData: requestPayload, responseData: successResponse, status: "credited" });

    // Emit Socket events if available
    if (ioInstance) {
      try {
        ioInstance.to(String(userId)).emit("wallet-updated", { balance: wallet.balance, coinsCredited: coinsToCredit });
        ioInstance.to(String(userId)).emit("purchase-success", { orderId: order.id, coins: coinsToCredit });
      } catch (sErr) {
        console.error("Socket emission error:", sErr);
      }
    }

    return successResponse;
  } catch (error) {
    await transaction.rollback();
    console.error("Google Play Transaction Error:", error);

    const failResponse = { message: error.message || "Failed to process wallet credit" };
    await auditLog({ userId, action: "CREDIT_FAILED", requestData: requestPayload, responseData: failResponse, status: "failed" });
    return { success: false, status: "failed", message: failResponse.message };
  }
};
