import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  cashfreeReturn,
  cashfreeWebhook,
  createCashfreePaymentOrder,
  createGatewayPaymentOrder,
  getCashfreeCheckoutHtml,
  getPaymentConfig,
  getRazorpayCheckoutHtml,
  razorpayReturn,
  razorpayWebhook,
  verifyCashfreePayment,
  verifyGatewayPayment,
  verifyRazorpayPayment,
} from "../controllers/payment.controller.js";

const router = express.Router();

router.get("/config", getPaymentConfig);

router.post(
  "/create-order",
  authMiddleware,
  createGatewayPaymentOrder
);

router.get(
  "/verify/:orderId",
  authMiddleware,
  verifyGatewayPayment
);

router.post(
  "/verify/:orderId",
  authMiddleware,
  verifyGatewayPayment
);

router.post(
  "/cashfree/create-order",
  authMiddleware,
  createCashfreePaymentOrder
);

router.get(
  "/cashfree/verify/:orderId",
  authMiddleware,
  verifyCashfreePayment
);

router.post("/cashfree/webhook", cashfreeWebhook);

router.get("/cashfree/return", cashfreeReturn);

router.get("/cashfree/checkout", getCashfreeCheckoutHtml);

router.post(
  "/razorpay/create-order",
  authMiddleware,
  createGatewayPaymentOrder
);

router.get(
  "/razorpay/verify/:orderId",
  authMiddleware,
  verifyRazorpayPayment
);

router.post(
  "/razorpay/verify/:orderId",
  authMiddleware,
  verifyRazorpayPayment
);

router.post("/razorpay/webhook", razorpayWebhook);

router.get("/razorpay/return", razorpayReturn);

router.get("/razorpay/checkout", getRazorpayCheckoutHtml);

export default router;
