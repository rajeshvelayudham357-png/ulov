import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  getPaymentProvider,
  getPaymentProductsList,
} from "../controllers/googleBilling.controller.js";
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
  createPayUPaymentOrder,
  verifyPayUPaymentController,
  payuWebhook,
  payuReturn,
  getPayUCheckoutHtml,
  createPhonePePaymentOrderController,
  verifyPhonePePaymentController,
  phonepeSyncPaymentController,
  phonepeWebhook,
  phonepeReturn,
  getPhonePeCheckoutHtml,
} from "../controllers/payment.controller.js";

const router = express.Router();

router.get("/config", getPaymentConfig);
router.get("/provider", getPaymentProvider);
router.get("/products", getPaymentProductsList);

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

router.post(
  "/payu/create-order",
  authMiddleware,
  createPayUPaymentOrder
);

router.get(
  "/payu/verify/:orderId",
  authMiddleware,
  verifyPayUPaymentController
);

router.post(
  "/payu/verify/:orderId",
  authMiddleware,
  verifyPayUPaymentController
);

router.post("/payu/webhook", payuWebhook);

router.get("/payu/return", payuReturn);
router.post("/payu/return", payuReturn);

router.get("/payu/checkout", getPayUCheckoutHtml);

router.post(
  "/phonepe/create-order",
  authMiddleware,
  createPhonePePaymentOrderController
);

router.get(
  "/phonepe/sync/:orderId",
  phonepeSyncPaymentController
);

router.get(
  "/phonepe/verify/:orderId",
  authMiddleware,
  verifyPhonePePaymentController
);

router.post(
  "/phonepe/verify/:orderId",
  authMiddleware,
  verifyPhonePePaymentController
);

router.post("/phonepe/webhook", phonepeWebhook);

router.get("/phonepe/return", phonepeReturn);
router.post("/phonepe/return", phonepeReturn);

router.get("/phonepe/checkout", getPhonePeCheckoutHtml);

export default router;
