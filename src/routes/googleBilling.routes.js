import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getPaymentProvider,
  getPaymentProductsList,
  verifyGooglePlayPurchase,
  handleGooglePlayWebhook,
} from "../controllers/googleBilling.controller.js";

const router = express.Router();

// Required requirement: GET /payment/provider
router.get("/provider", getPaymentProvider);

// Required requirement: GET /payment/products
router.get("/products", getPaymentProductsList);

// Required requirement: POST /google-play/verify
router.post("/verify", authMiddleware, verifyGooglePlayPurchase);

// Required requirement: POST /google-play/webhook
router.post("/webhook", handleGooglePlayWebhook);

export default router;
