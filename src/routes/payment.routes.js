import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import {
  cashfreeReturn,
  cashfreeWebhook,
  createCashfreePaymentOrder,
  getCashfreeCheckoutHtml,
  verifyCashfreePayment,
} from "../controllers/payment.controller.js";

const router = express.Router();

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

router.post(
  "/cashfree/webhook",
  cashfreeWebhook
);

router.get(
  "/cashfree/return",
  cashfreeReturn
);

router.get(
  "/cashfree/checkout",
  getCashfreeCheckoutHtml
);

export default router;
