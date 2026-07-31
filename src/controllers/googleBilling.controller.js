import {
  getPaymentProducts,
  verifyAndCreditGooglePlayPurchase,
} from "../services/googleBilling.service.js";
import { getPaymentSettings } from "../services/paymentSettings.service.js";

export const getPaymentProvider = async (_req, res) => {
  try {
    const settings = await getPaymentSettings();
    return res.json({
      provider: settings.activeGateway,
      activeGateway: settings.activeGateway,
      googlePlayEnabled: settings.googlePlayEnabled,
      googlePlayEnv: settings.googlePlayEnv,
      googlePlayPackageName: settings.googlePlayPackageName,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Failed to load payment provider",
    });
  }
};

export const getPaymentProductsList = async (req, res) => {
  try {
    const settings = await getPaymentSettings();
    const provider = req.query.provider || settings.activeGateway || "google_play";
    const platform = req.query.platform || "android";

    const products = await getPaymentProducts(provider, platform);
    return res.json({
      provider,
      platform,
      products,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Failed to load payment products",
    });
  }
};

export const verifyGooglePlayPurchase = async (req, res) => {
  try {
    const userId = Number(req.user?.id || req.body?.userId);
    const { productId, purchaseToken, packageName } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized or missing userId" });
    }

    const result = await verifyAndCreditGooglePlayPurchase({
      productId,
      purchaseToken,
      userId,
      packageName,
    });

    if (!result.success && result.status === "failed") {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: "failed",
      message: error.message || "Failed to verify purchase",
    });
  }
};

export const handleGooglePlayWebhook = async (req, res) => {
  try {
    console.log("GOOGLE PLAY RTDN WEBHOOK EVENT:", JSON.stringify(req.body));
    // Acknowledge Google RTDN Pub/Sub message immediately
    return res.status(200).send({ received: true });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
