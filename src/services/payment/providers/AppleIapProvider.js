import { BasePaymentProvider } from "./BasePaymentProvider.js";

export class AppleIapProvider extends BasePaymentProvider {
  constructor() {
    super("apple_iap");
  }
}
