import { BasePaymentProvider } from "./BasePaymentProvider.js";

export class CashfreeProvider extends BasePaymentProvider {
  constructor() {
    super("cashfree");
  }
}
