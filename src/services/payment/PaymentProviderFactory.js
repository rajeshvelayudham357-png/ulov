import { CashfreeProvider } from "./providers/CashfreeProvider.js";
import { RazorpayProvider } from "./providers/RazorpayProvider.js";
import { GooglePlayProvider } from "./providers/GooglePlayProvider.js";
import { AppleIapProvider } from "./providers/AppleIapProvider.js";
import { getPaymentSettings } from "../paymentSettings.service.js";

export class PaymentProviderFactory {
  static providers = {
    cashfree: new CashfreeProvider(),
    razorpay: new RazorpayProvider(),
    google_play: new GooglePlayProvider(),
    apple_iap: new AppleIapProvider(),
  };

  static getProvider(name) {
    const key = String(name || "").toLowerCase().trim();
    return this.providers[key] || this.providers.cashfree;
  }

  static async getActiveProvider() {
    const settings = await getPaymentSettings();
    return this.getProvider(settings.activeGateway);
  }
}
