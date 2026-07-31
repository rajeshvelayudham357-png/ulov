export class BasePaymentProvider {
  constructor(name) {
    this.name = name;
  }

  async verifyPurchase(_params) {
    throw new Error(`verifyPurchase not implemented for ${this.name}`);
  }

  async createOrder(_params) {
    throw new Error(`createOrder not implemented for ${this.name}`);
  }

  async acknowledgePurchase(_params) {
    throw new Error(`acknowledgePurchase not implemented for ${this.name}`);
  }
}
