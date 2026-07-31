import fs from "fs";
import path from "path";
import axios from "axios";
import { BasePaymentProvider } from "./BasePaymentProvider.js";
import { getPaymentSettings } from "../../paymentSettings.service.js";

export class GooglePlayProvider extends BasePaymentProvider {
  constructor() {
    super("google_play");
  }

  getServiceAccountPath() {
    if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH) {
      return process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH;
    }
    // Fallback path inside backend config
    return path.resolve(process.cwd(), "src/config/google-play-service-account.json");
  }

  getServiceAccountCredentials() {
    const filePath = this.getServiceAccountPath();
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        return JSON.parse(content);
      } catch (err) {
        console.error("Failed to parse Google Service Account JSON file:", err);
      }
    }
    return null;
  }

  /**
   * Verified Google Play Purchase Token with Google Developer API
   */
  async verifyPurchase({ packageName, productId, purchaseToken }) {
    const settings = await getPaymentSettings();
    const pkg = packageName || settings.googlePlayPackageName || "com.ulov.app";

    // In test environment or fallback without service account file, return mock verification for testing
    const credentials = this.getServiceAccountCredentials();

    if (!credentials) {
      console.error("GOOGLE PLAY BILLING: No Service Account JSON found at", this.getServiceAccountPath());
      throw new Error(`Google Play Service Account JSON not found at ${this.getServiceAccountPath()}`);
    }

    try {
      // Obtain Google OAuth2 access token via service account JWT assertion
      const jwtToken = await this.getAccessToken(credentials);

      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${jwtToken}` },
      });

      const data = response.data;
      const verified = data.purchaseState === 0;

      return {
        verified,
        purchaseState: data.purchaseState,
        acknowledgementState: data.acknowledgementState,
        orderId: data.orderId || `GPA.${Date.now()}`,
        productId,
        packageName: pkg,
        purchaseTimeMillis: data.purchaseTimeMillis,
        raw: data,
      };
    } catch (error) {
      console.error("Google Play API Purchase Verification Failed:", error?.response?.data || error.message);
      return {
        verified: false,
        error: error?.response?.data?.error?.message || error.message,
      };
    }
  }

  async acknowledgePurchase({ packageName, productId, purchaseToken }) {
    const settings = await getPaymentSettings();
    const pkg = packageName || settings.googlePlayPackageName || "com.ulov.app";
    const credentials = this.getServiceAccountCredentials();

    if (!credentials) {
      return { acknowledged: true, testMode: true };
    }

    try {
      const jwtToken = await this.getAccessToken(credentials);
      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;

      await axios.post(url, {}, {
        headers: { Authorization: `Bearer ${jwtToken}` },
      });

      return { acknowledged: true };
    } catch (error) {
      console.error("Google Play Purchase Acknowledge Failed:", error?.response?.data || error.message);
      return { acknowledged: false, error: error.message };
    }
  }

  async getAccessToken(credentials) {
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    // Use JWT sign via crypto module
    const crypto = await import("crypto");

    const base64UrlEncode = (str) =>
      Buffer.from(str)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64UrlEncode(JSON.stringify(claim));

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const signature = base64UrlEncode(signer.sign(credentials.private_key));

    const jwt = `${header}.${payload}.${signature}`;

    const res = await axios.post("https://oauth2.googleapis.com/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    });

    return res.data.access_token;
  }
}
