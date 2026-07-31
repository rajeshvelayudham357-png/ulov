import { BasePaymentProvider } from "./BasePaymentProvider.js";

export class RazorpayProvider extends BasePaymentProvider {
  constructor() {
    super("razorpay");
  }
}
