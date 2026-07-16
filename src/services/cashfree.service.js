import axios from "axios";

const API_VERSION = "2023-08-01";

const getCashfreeConfig = () => {
  const clientId = process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
  const env = (
    process.env.CASHFREE_ENV || "sandbox"
  ).toLowerCase();

  if (!clientId || !clientSecret) {
    throw new Error(
      "Cashfree credentials are not configured"
    );
  }

  const baseUrl =
    env === "production"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg";

  return {
    clientId,
    clientSecret,
    env,
    baseUrl,
    checkoutMode:
      env === "production"
        ? "production"
        : "sandbox",
  };
};

const cashfreeHeaders = () => {
  const { clientId, clientSecret } =
    getCashfreeConfig();

  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-api-version": API_VERSION,
    "x-client-id": clientId,
    "x-client-secret": clientSecret,
  };
};

export const createCashfreeOrder = async ({
  orderId,
  amount,
  customerDetails,
  returnUrl,
  notifyUrl,
}) => {
  const { baseUrl } = getCashfreeConfig();

  const response = await axios.post(
    `${baseUrl}/orders`,
    {
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: "INR",
      customer_details: customerDetails,
      order_meta: {
        return_url: returnUrl,
        notify_url: notifyUrl,
      },
    },
    {
      headers: cashfreeHeaders(),
    }
  );

  return response.data;
};

export const fetchCashfreeOrder = async (orderId) => {
  const { baseUrl } = getCashfreeConfig();

  const response = await axios.get(
    `${baseUrl}/orders/${orderId}`,
    {
      headers: cashfreeHeaders(),
    }
  );

  return response.data;
};

export const getCashfreeCheckoutMode = () =>
  getCashfreeConfig().checkoutMode;

export const getPublicApiBaseUrl = () => {
  const configured =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.API_PUBLIC_URL;

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const port = process.env.PORT || 3001;
  return `http://localhost:${port}`;
};
