import {
  createPaymentOrder,
  getPaymentOrderForUser,
  handleCashfreeWebhook,
  syncPaymentOrderFromCashfree,
} from "../services/payment.service.js";
import { getCashfreeCheckoutMode } from "../services/cashfree.service.js";

export const createCashfreePaymentOrder = async (
  req,
  res
) => {
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

    const { paymentOrder, cashfreeOrder } =
      await createPaymentOrder({
        userId,
        packageId,
      });

    return res.json({
      orderId: paymentOrder.orderId,
      paymentSessionId:
        paymentOrder.paymentSessionId,
      amount: Number(paymentOrder.amount),
      coins: paymentOrder.coins,
      packageId: paymentOrder.packageId,
      status: paymentOrder.status,
      cashfreeMode: getCashfreeCheckoutMode(),
      cashfreeOrderStatus:
        cashfreeOrder.order_status,
    });
  } catch (error) {
    console.log(
      "CREATE CASHFREE ORDER ERROR:",
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

export const verifyCashfreePayment = async (
  req,
  res
) => {
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

    const result =
      await syncPaymentOrderFromCashfree(
        orderId
      );

    return res.json({
      orderId: result.paymentOrder.orderId,
      status: result.paymentOrder.status,
      coins: result.paymentOrder.coins,
      amount: Number(result.paymentOrder.amount),
      credited: result.credited,
      wallet: result.wallet,
      cashfreeOrderStatus:
        result.cashfreeOrder?.order_status,
    });
  } catch (error) {
    console.log(
      "VERIFY CASHFREE PAYMENT ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message:
        error.message ||
        "Failed to verify payment",
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
    console.log(
      "CASHFREE WEBHOOK ERROR:",
      error.message
    );

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const cashfreeReturn = async (req, res) => {
  const orderId = req.query.order_id || "";

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
        type: "cashfree_return",
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
</html>`);
};

export const getCashfreeCheckoutHtml = async (
  req,
  res
) => {
  const paymentSessionId =
    req.query.payment_session_id || "";
  const orderId = req.query.order_id || "";
  const mode = getCashfreeCheckoutMode();

  if (!paymentSessionId || !orderId) {
    return res.status(400).send(
      "payment_session_id and order_id are required"
    );
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
      const paymentSessionId = ${JSON.stringify(
        paymentSessionId
      )};
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
