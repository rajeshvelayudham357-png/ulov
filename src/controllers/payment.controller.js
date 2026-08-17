import {
  createPaymentOrder,
  getPaymentOrderForUser,
  handleCashfreeWebhook,
  handleRazorpayWebhook,
  handlePayUWebhook,
  handlePhonePeWebhook,
  syncPaymentOrder,
  syncPaymentOrderFromCashfree,
  syncPaymentOrderFromRazorpay,
  syncPaymentOrderFromPayU,
  syncPaymentOrderFromPhonePe,
} from "../services/payment.service.js";
import { PaymentOrder } from "../models/index.js";
import {
  getCashfreeCheckoutMode,
  getPublicApiBaseUrl,
} from "../services/cashfree.service.js";
import {
  getPublicPaymentConfig,
} from "../services/paymentSettings.service.js";
import {
  getRazorpayCheckoutKeyId,
  verifyRazorpayWebhookSignature,
} from "../services/razorpay.service.js";
import {
  getPayUCheckoutPayload,
  verifyPayUWebhookSignature,
} from "../services/payu.service.js";
import {
  initiatePhonePePayment,
  verifyPhonePeWebhookSignature,
} from "../services/phonepe.service.js";
import { getAllPurchasablePackages } from "../constants/goldPackages.js";

const buildCreateOrderResponse = async (result) => {
  const base = {
    orderId: result.paymentOrder.orderId,
    gateway: result.gateway,
    paymentSessionId: result.paymentOrder.paymentSessionId,
    amount: Number(result.paymentOrder.amount),
    coins: result.paymentOrder.coins,
    packageId: result.paymentOrder.packageId,
    status: result.paymentOrder.status,
  };

  if (result.gateway === "razorpay") {
    return {
      ...base,
      razorpayOrderId: result.paymentOrder.razorpayOrderId,
      razorpayKeyId: result.razorpayKeyId,
      razorpayMode: result.razorpayMode,
      customerContact: result.customerContact,
      customerEmail: result.customerEmail,
      customerName: result.customerName,
    };
  }

  if (result.gateway === "payu") {
    return {
      ...base,
      payuPayload: result.payuPayload,
      customerContact: result.customerContact,
      customerEmail: result.customerEmail,
      customerName: result.customerName,
    };
  }

  if (result.gateway === "phonepe") {
    return {
      ...base,
      phonepeRedirectUrl: result.phonepeRedirectUrl,
      phonepePayload: result.phonepePayload,
      customerContact: result.customerContact,
      customerEmail: result.customerEmail,
      customerName: result.customerName,
    };
  }

  return {
    ...base,
    cashfreeMode:
      result.cashfreeMode || (await getCashfreeCheckoutMode()),
    cashfreeOrderStatus: result.cashfreeOrder?.order_status,
  };
};

export const getPaymentConfig = async (_req, res) => {
  try {
    const config = await getPublicPaymentConfig();
    return res.json(config);
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Failed to load payment config",
    });
  }
};

export const getPaymentPackages = async (_req, res) => {
  try {
    const packages = await getAllPurchasablePackages();
    return res.json(packages);
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Failed to load gold packages",
    });
  }
};

export const createGatewayPaymentOrder = async (req, res) => {
  try {
    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { packageId } = req.body;

    if (!packageId) {
      return res.status(400).json({
        message: "packageId is required",
      });
    }

    const result = await createPaymentOrder({
      userId,
      packageId,
    });

    return res.json(await buildCreateOrderResponse(result));
  } catch (error) {
    console.log(
      "CREATE PAYMENT ORDER ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to create payment order",
    });
  }
};

export const createCashfreePaymentOrder = async (req, res) => {
  return createGatewayPaymentOrder(req, res);
};

export const verifyGatewayPayment = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const { orderId } = req.params;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const paymentOrder = await getPaymentOrderForUser({
      orderId,
      userId,
    });

    const result = await syncPaymentOrder(orderId, {
      razorpayPaymentId:
        req.body?.razorpay_payment_id ||
        req.body?.razorpayPaymentId ||
        req.query?.razorpay_payment_id ||
        null,
      razorpaySignature:
        req.body?.razorpay_signature ||
        req.body?.razorpaySignature ||
        req.query?.razorpay_signature ||
        null,
    });

    return res.json({
      orderId: result.paymentOrder.orderId,
      gateway: paymentOrder.gateway || result.paymentOrder.gateway,
      status: result.paymentOrder.status,
      coins: result.paymentOrder.coins,
      amount: Number(result.paymentOrder.amount),
      credited: result.credited,
      wallet: result.wallet,
      cashfreeOrderStatus: result.cashfreeOrder?.order_status,
      razorpayOrderStatus: result.razorpayOrder?.status,
    });
  } catch (error) {
    console.log(
      "VERIFY PAYMENT ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: error.message || "Failed to verify payment",
    });
  }
};

export const verifyCashfreePayment = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const { orderId } = req.params;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    await getPaymentOrderForUser({
      orderId,
      userId,
    });

    const result = await syncPaymentOrderFromCashfree(orderId);

    return res.json({
      orderId: result.paymentOrder.orderId,
      gateway: "cashfree",
      status: result.paymentOrder.status,
      coins: result.paymentOrder.coins,
      amount: Number(result.paymentOrder.amount),
      credited: result.credited,
      wallet: result.wallet,
      cashfreeOrderStatus: result.cashfreeOrder?.order_status,
    });
  } catch (error) {
    console.log(
      "VERIFY CASHFREE PAYMENT ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: error.message || "Failed to verify payment",
    });
  }
};

export const verifyRazorpayPayment = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const { orderId } = req.params;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    await getPaymentOrderForUser({
      orderId,
      userId,
    });

    const result = await syncPaymentOrderFromRazorpay(orderId, {
      razorpayPaymentId:
        req.body?.razorpay_payment_id ||
        req.body?.razorpayPaymentId ||
        null,
      razorpaySignature:
        req.body?.razorpay_signature ||
        req.body?.razorpaySignature ||
        null,
    });

    return res.json({
      orderId: result.paymentOrder.orderId,
      gateway: "razorpay",
      status: result.paymentOrder.status,
      coins: result.paymentOrder.coins,
      amount: Number(result.paymentOrder.amount),
      credited: result.credited,
      wallet: result.wallet,
      razorpayOrderStatus: result.razorpayOrder?.status,
    });
  } catch (error) {
    console.log(
      "VERIFY RAZORPAY PAYMENT ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: error.message || "Failed to verify payment",
    });
  }
};

export const cashfreeWebhook = async (req, res) => {
  try {
    await handleCashfreeWebhook(req.body);

    return res.json({
      success: true,
    });
  } catch (error) {
    console.log("CASHFREE WEBHOOK ERROR:", error.message);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody =
      typeof req.rawBody === "string"
        ? req.rawBody
        : JSON.stringify(req.body || {});

    const valid = await verifyRazorpayWebhookSignature({
      rawBody,
      signature,
    });

    if (!valid) {
      return res.status(400).json({
        success: false,
        message: "Invalid webhook signature",
      });
    }

    await handleRazorpayWebhook(req.body);

    return res.json({
      success: true,
    });
  } catch (error) {
    console.log("RAZORPAY WEBHOOK ERROR:", error.message);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const paymentReturnHtml = (orderId, type) => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Payment Complete</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        background: #fff4f8;
        color: #333;
      }
      .card {
        text-align: center;
        padding: 24px;
      }
      h1 {
        color: #ff2e73;
        margin-bottom: 8px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Payment Received</h1>
      <p>Returning to Ulov...</p>
    </div>
    <script>
      const payload = {
        type: ${JSON.stringify(type)},
        orderId: ${JSON.stringify(orderId)}
      };

      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }

      setTimeout(function () {
        window.location.href = "datingapp://payment/result?order_id=${encodeURIComponent(
          orderId
        )}";
      }, 600);
    </script>
  </body>
</html>`;

export const cashfreeReturn = async (req, res) => {
  const orderId = req.query.order_id || "";
  res.setHeader("Content-Type", "text/html");
  return res.send(paymentReturnHtml(orderId, "cashfree_return"));
};

export const razorpayReturn = async (req, res) => {
  const orderId = req.query.order_id || "";
  const razorpayPaymentId = req.query.razorpay_payment_id || "";
  const razorpayOrderId = req.query.razorpay_order_id || "";
  const razorpaySignature = req.query.razorpay_signature || "";

  if (orderId) {
    try {
      await syncPaymentOrderFromRazorpay(orderId, {
        razorpayPaymentId,
        razorpaySignature,
      });
    } catch (error) {
      console.log(
        "RAZORPAY RETURN SYNC ERROR:",
        error.message
      );
    }
  }

  res.setHeader("Content-Type", "text/html");
  return res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Payment Complete</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        background: #fff4f8;
        color: #333;
      }
      .card {
        text-align: center;
        padding: 24px;
      }
      h1 {
        color: #ff2e73;
        margin-bottom: 8px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Payment Received</h1>
      <p>Returning to Ulov...</p>
    </div>
    <script>
      const payload = {
        type: "razorpay_return",
        orderId: ${JSON.stringify(orderId)},
        razorpay_payment_id: ${JSON.stringify(razorpayPaymentId)},
        razorpay_order_id: ${JSON.stringify(razorpayOrderId)},
        razorpay_signature: ${JSON.stringify(razorpaySignature)}
      };

      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }

      setTimeout(function () {
        window.location.href =
          "datingapp://payment/result?order_id=" +
          encodeURIComponent(${JSON.stringify(orderId)}) +
          "&razorpay_payment_id=" + encodeURIComponent(${JSON.stringify(razorpayPaymentId)}) +
          "&razorpay_signature=" + encodeURIComponent(${JSON.stringify(razorpaySignature)});
      }, 600);
    </script>
  </body>
</html>`);
};

export const getCashfreeCheckoutHtml = async (req, res) => {
  const paymentSessionId = req.query.payment_session_id || "";
  const orderId = req.query.order_id || "";
  const mode = await getCashfreeCheckoutMode();

  if (!paymentSessionId || !orderId) {
    return res
      .status(400)
      .send("payment_session_id and order_id are required");
  }

  const publicApiBaseUrl =
    process.env.PUBLIC_API_BASE_URL ||
    `${req.protocol}://${req.get("host")}`;
  const returnUrl = `${publicApiBaseUrl}/api/payments/cashfree/return?order_id=${encodeURIComponent(
    orderId
  )}`;

  res.setHeader("Content-Type", "text/html");
  return res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ulov Checkout</title>
    <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        background: #fff;
        color: #333;
      }
      .wrap {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        text-align: center;
      }
      button {
        background: #ff2e73;
        color: #fff;
        border: 0;
        border-radius: 14px;
        padding: 14px 24px;
        font-size: 16px;
        font-weight: 700;
      }
      .error {
        color: #c62828;
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div>
        <h2>Secure Payment</h2>
        <p>Pay safely with UPI, cards, or wallets via Cashfree.</p>
        <button id="pay-btn" type="button">Continue to Pay</button>
        <div id="error" class="error"></div>
      </div>
    </div>
    <script>
      const paymentSessionId = ${JSON.stringify(paymentSessionId)};
      const returnUrl = ${JSON.stringify(returnUrl)};
      const mode = ${JSON.stringify(mode)};

      const cashfree = Cashfree({ mode });

      document.getElementById("pay-btn").addEventListener("click", function () {
        cashfree.checkout({
          paymentSessionId,
          returnUrl
        }).catch(function (error) {
          document.getElementById("error").textContent =
            error?.message || "Unable to open checkout";
        });
      });

      setTimeout(function () {
        document.getElementById("pay-btn").click();
      }, 300);
    </script>
  </body>
</html>`);
};

export const getRazorpayCheckoutHtml = async (req, res) => {
  const orderId = req.query.order_id || "";
  const razorpayOrderId = req.query.razorpay_order_id || "";
  const amount = Number(req.query.amount || 0);
  const name = req.query.name || "Ulov Gold";
  const contact = String(req.query.contact || "").replace(/\D/g, "").slice(-10);
  const email = String(req.query.email || "");
  const customerName = String(req.query.customer_name || "Ulov User");

  if (!orderId || !razorpayOrderId) {
    return res
      .status(400)
      .send("order_id and razorpay_order_id are required");
  }

  let keyId;

  try {
    keyId = await getRazorpayCheckoutKeyId();
  } catch (error) {
    return res.status(500).send(error.message);
  }

  const publicApiBaseUrl =
    getPublicApiBaseUrl() ||
    `${req.protocol}://${req.get("host")}`;
  const returnUrl = `${publicApiBaseUrl}/api/payments/razorpay/return?order_id=${encodeURIComponent(
    orderId
  )}`;

  res.setHeader("Content-Type", "text/html");
  return res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ulov Checkout</title>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        background: #fff;
        color: #333;
      }
      .wrap {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        text-align: center;
      }
      button {
        background: #ff2e73;
        color: #fff;
        border: 0;
        border-radius: 14px;
        padding: 14px 24px;
        font-size: 16px;
        font-weight: 700;
      }
      .error {
        color: #c62828;
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div>
        <h2>Secure Payment</h2>
        <p>Pay safely with UPI, cards, or wallets via Razorpay.</p>
        <button id="pay-btn" type="button">Continue to Pay</button>
        <div id="error" class="error"></div>
      </div>
    </div>
    <script>
      const keyId = ${JSON.stringify(keyId)};
      const orderId = ${JSON.stringify(orderId)};
      const razorpayOrderId = ${JSON.stringify(razorpayOrderId)};
      const amountPaise = ${JSON.stringify(Math.round(amount * 100))};
      const name = ${JSON.stringify(name)};
      const returnUrl = ${JSON.stringify(returnUrl)};
      const contact = ${JSON.stringify(contact)};
      const email = ${JSON.stringify(email)};
      const customerName = ${JSON.stringify(customerName)};

      function openCheckout() {
        const options = {
          key: keyId,
          amount: amountPaise,
          currency: "INR",
          name: "Ulov",
          description: name,
          order_id: razorpayOrderId,
          theme: { color: "#FF2E73" },
          // Required for UPI apps inside Android WebView checkout
          webview_intent: true,
          method: {
            upi: true,
            card: true,
            netbanking: true,
            wallet: true
          },
          prefill: {
            name: customerName || "Ulov User",
            email: email || undefined,
            contact: contact || undefined
          },
          handler: function (response) {
            const payload = {
              type: "razorpay_success",
              orderId: orderId,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            };

            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify(payload));
            }

            window.location.href =
              returnUrl +
              "&razorpay_payment_id=" + encodeURIComponent(response.razorpay_payment_id || "") +
              "&razorpay_order_id=" + encodeURIComponent(response.razorpay_order_id || "") +
              "&razorpay_signature=" + encodeURIComponent(response.razorpay_signature || "");
          },
          modal: {
            ondismiss: function () {
              const payload = {
                type: "razorpay_dismiss",
                orderId: orderId
              };

              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify(payload));
              }
            }
          }
        };

        const rzp = new Razorpay(options);
        rzp.on("payment.failed", function (response) {
          document.getElementById("error").textContent =
            response?.error?.description || "Payment failed";
        });
        rzp.open();
      }

      document.getElementById("pay-btn").addEventListener("click", openCheckout);
      setTimeout(openCheckout, 300);
    </script>
  </body>
</html>`);
};

export const createPayUPaymentOrder = async (req, res) => {
  return createGatewayPaymentOrder(req, res);
};

export const getPayUCheckoutHtml = async (req, res) => {
  const orderId = req.query.order_id || "";
  const amount = Number(req.query.amount || 0);
  const name = String(req.query.customer_name || "Ulov User");
  const email = String(req.query.email || "");
  const contact = String(req.query.contact || "").replace(/\D/g, "").slice(-10);
  const productinfo = String(req.query.productinfo || "Ulov Coins");

  if (!orderId) {
    return res.status(400).send("order_id is required");
  }

  let payload;
  try {
    const publicApiBaseUrl =
      getPublicApiBaseUrl() ||
      `${req.protocol}://${req.get("host")}`;
    const successUrl = `${publicApiBaseUrl}/api/payments/payu/return?order_id=${encodeURIComponent(orderId)}&status=success`;
    const failureUrl = `${publicApiBaseUrl}/api/payments/payu/return?order_id=${encodeURIComponent(orderId)}&status=failure`;

    payload = await getPayUCheckoutPayload({
      txnid: orderId,
      amount,
      productinfo,
      firstname: name,
      email: email || `order@ulov.app`,
      phone: contact || "9999999999",
      udf1: orderId,
      successUrl,
      failureUrl,
    });
  } catch (error) {
    return res.status(500).send(error.message);
  }

  const fields = Object.entries(payload)
    .filter(([k]) => k !== "action" && k !== "env")
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v || "").replace(/"/g, "&quot;")}" />`)
    .join("\n      ");

  res.setHeader("Content-Type", "text/html");
  return res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ulov Checkout</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #fff4f8; }
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
      .card { text-align: center; padding: 24px; }
      h2 { color: #ff2e73; }
    </style>
  </head>
  <body>
    <div class="wrap"><div class="card">
      <h2>Redirecting to PayU...</h2>
      <p>Please wait while we redirect you to the secure payment page.</p>
    </div></div>
    <form id="payu-form" method="post" action="${payload.action}">
      ${fields}
    </form>
    <script>document.getElementById("payu-form").submit();</script>
  </body>
</html>`);
};

export const verifyPayUPaymentController = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const { orderId } = req.params;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    await getPaymentOrderForUser({ orderId, userId });

    const responseParams = {
      ...req.body,
      ...req.query,
    };

    const result = await syncPaymentOrderFromPayU(orderId, responseParams);

    return res.json({
      orderId: result.paymentOrder.orderId,
      gateway: "payu",
      status: result.paymentOrder.status,
      coins: result.paymentOrder.coins,
      amount: Number(result.paymentOrder.amount),
      credited: result.credited,
      wallet: result.wallet,
      payuStatus: result.payuStatus,
    });
  } catch (error) {
    console.error("VERIFY PAYU PAYMENT ERROR:", error.message);
    return res.status(500).json({ message: error.message || "Failed to verify PayU payment" });
  }
};

export const payuWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-payu-signature"] || req.headers["x-webhook-signature"] || "";
    const rawBody = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body || {});

    const valid = await verifyPayUWebhookSignature({ rawBody, signature });
    if (!valid) {
      return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    }

    await handlePayUWebhook(req.body);
    return res.json({ success: true });
  } catch (error) {
    console.error("PAYU WEBHOOK ERROR:", error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const payuReturn = async (req, res) => {
  const orderId = req.query.order_id || req.body?.txnid || "";
  const status = req.query.status || req.body?.status || "";
  const payuPaymentId = req.body?.mihpayid || req.query?.mihpayid || "";
  const txnid = req.body?.txnid || req.query?.txnid || orderId;
  const hash = req.body?.hash || req.query?.hash || "";

  res.setHeader("Content-Type", "text/html");
  return res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Payment Complete</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fff4f8; }
      .card { text-align: center; padding: 24px; }
      h1 { color: #ff2e73; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Payment ${String(status).toLowerCase() === "success" ? "Successful" : "Processed"}</h1>
      <p>Returning to Ulov...</p>
    </div>
    <script>
      const payload = {
        type: "payu_return",
        orderId: ${JSON.stringify(orderId)},
        status: ${JSON.stringify(status)},
        payu_payment_id: ${JSON.stringify(payuPaymentId)},
        txnid: ${JSON.stringify(txnid)},
        hash: ${JSON.stringify(hash)}
      };
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
      setTimeout(function() {
        window.location.href = "datingapp://payment/result?order_id=" + encodeURIComponent(${JSON.stringify(orderId)}) + "&status=" + encodeURIComponent(${JSON.stringify(status)});
      }, 600);
    </script>
  </body>
</html>`);
};

export const createPhonePePaymentOrderController = async (req, res) => {
  return createGatewayPaymentOrder(req, res);
};

export const getPhonePeCheckoutHtml = async (req, res) => {
  const orderId = req.query.order_id || "";

  if (!orderId) {
    return res.status(400).send("order_id is required");
  }

  try {
    const paymentOrder = await PaymentOrder.findOne({ where: { orderId } });

    if (!paymentOrder) {
      return res.status(404).send("Payment order not found");
    }

    const redirectUrl =
      paymentOrder.phonepeRedirectUrl ||
      req.query.redirect_url ||
      null;

    if (redirectUrl) {
      return res.redirect(redirectUrl);
    }

    return res
      .status(400)
      .send("PhonePe checkout URL is not available for this order. Create a new order and try again.");
  } catch (error) {
    console.error("PHONEPE CHECKOUT HTML ERROR:", error.message);
    return res.status(500).send(error.message || "Failed to open PhonePe checkout");
  }
};

const buildPhonePeSyncResponse = (result) => ({
  orderId: result.paymentOrder.orderId,
  gateway: "phonepe",
  status: result.paymentOrder.status,
  coins: result.paymentOrder.coins,
  amount: Number(result.paymentOrder.amount),
  credited: result.credited,
  wallet: result.wallet,
  phonepeStatus: result.phonepeStatus,
});

export const phonepeSyncPaymentController = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const result = await syncPaymentOrderFromPhonePe(orderId);
    return res.json(buildPhonePeSyncResponse(result));
  } catch (error) {
    console.error("PHONEPE SYNC ERROR:", error.message);
    return res.status(500).json({
      message: error.message || "Failed to sync PhonePe payment",
    });
  }
};

export const verifyPhonePePaymentController = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const { orderId } = req.params;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    await getPaymentOrderForUser({ orderId, userId });

    const result = await syncPaymentOrderFromPhonePe(orderId);

    return res.json(buildPhonePeSyncResponse(result));
  } catch (error) {
    console.error("VERIFY PHONEPE PAYMENT ERROR:", error.message);
    return res.status(500).json({ message: error.message || "Failed to verify PhonePe payment" });
  }
};

export const phonepeWebhook = async (req, res) => {
  try {
    const xVerifyHeader = req.headers["x-verify"] || "";
    const result = await handlePhonePeWebhook(req.body, xVerifyHeader);
    return res.json({ success: true, responseCode: "SUCCESS", data: result });
  } catch (error) {
    console.error("PHONEPE WEBHOOK ERROR:", error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const phonepeReturn = async (req, res) => {
  const orderId =
    req.query.order_id ||
    req.body?.merchantOrderId ||
    req.body?.merchantTransactionId ||
    req.body?.transactionId ||
    "";
  const code = req.query.code || req.body?.code || "";

  let paymentStatus = "PENDING";
  let credited = false;

  if (orderId) {
    try {
      const result = await syncPaymentOrderFromPhonePe(orderId);
      paymentStatus = result?.paymentOrder?.status || paymentStatus;
      credited = Boolean(result?.credited);
    } catch (error) {
      console.error("PHONEPE RETURN SYNC ERROR:", error.message);
    }
  }

  const isPaid =
    String(paymentStatus).toUpperCase() === "PAID" ||
    String(code).toUpperCase() === "PAYMENT_SUCCESS";

  res.setHeader("Content-Type", "text/html");
  return res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Payment Complete</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fff4f8; }
      .card { text-align: center; padding: 24px; }
      h1 { color: #ff2e73; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Payment ${isPaid ? "Successful" : "Processed"}</h1>
      <p>Returning to Ulov...</p>
    </div>
    <script>
      const payload = {
        type: "phonepe_return",
        orderId: ${JSON.stringify(orderId)},
        code: ${JSON.stringify(code)},
        status: ${JSON.stringify(paymentStatus)},
        credited: ${JSON.stringify(credited)}
      };
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
      setTimeout(function() {
        window.location.href = "datingapp://payment/result?order_id=" + encodeURIComponent(${JSON.stringify(orderId)}) + "&status=" + encodeURIComponent(${JSON.stringify(paymentStatus)});
      }, 600);
    </script>
  </body>
</html>`);
};
