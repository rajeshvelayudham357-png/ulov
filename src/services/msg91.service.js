const MSG91_VERIFY_ACCESS_TOKEN_URL =
  "https://control.msg91.com/api/v5/widget/verifyAccessToken";

const FALLBACK_OTP = "12345";

export const normalizeIndianPhone = (phone) => {
  const digits = String(phone ?? "").replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }

  if (digits.length === 10) {
    return digits;
  }

  return digits.slice(-10);
};

export const verifyMsg91AccessToken = async (accessToken) => {
  const authKey = process.env.MSG91_AUTH_KEY;

  if (!authKey) {
    throw new Error(
      "MSG91_AUTH_KEY is not configured on the server. Add your account Auth Key from the MSG91 OTP widget Server-Side Integration section."
    );
  }

  if (!accessToken) {
    return false;
  }

  const response = await fetch(MSG91_VERIFY_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authkey: authKey,
      "access-token": accessToken,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (data?.type !== "success") {
    console.error("[MSG91] Access token verification failed:", data);
  }

  return data?.type === "success";
};

export const isFallbackOtp = (otp) => String(otp ?? "").trim() === FALLBACK_OTP;
