import { User, Wallet } from "../models/index.js";
import { getAppSettings } from "./appSettings.service.js";
import {
  LOW_BALANCE_OFFER_PACKAGE_ID,
  buildLowBalanceOfferPackage,
} from "../constants/goldPackages.js";

export const getLowBalanceOfferPublicConfig = async () => {
  const settings = await getAppSettings();
  const pack = buildLowBalanceOfferPackage(settings);

  return {
    enabled: settings.lowBalanceOfferEnabled,
    threshold: settings.lowBalanceThreshold,
    packageId: LOW_BALANCE_OFFER_PACKAGE_ID,
    coins: pack?.coins ?? settings.lowBalanceOfferCoins,
    price: pack?.price ?? settings.lowBalanceOfferPrice,
    originalPrice: settings.lowBalanceOfferOriginalPrice,
    title: settings.lowBalanceOfferTitle,
    subtitle: settings.lowBalanceOfferSubtitle,
    socialProof: settings.lowBalanceOfferSocialProof,
    updatedAt: settings.updatedAt || null,
  };
};

export const getLowBalanceOfferEligibility = async (userId) => {
  const settings = await getAppSettings();
  const config = await getLowBalanceOfferPublicConfig();
  const pack = buildLowBalanceOfferPackage(settings);

  const user = await User.findByPk(userId, {
    attributes: ["id", "gender", "profileCompleted"],
  });

  if (!user) {
    return {
      ...config,
      eligible: false,
      reason: "user_not_found",
      balance: 0,
    };
  }

  if (!settings.lowBalanceOfferEnabled || !pack) {
    return {
      ...config,
      eligible: false,
      reason: "disabled",
      balance: 0,
    };
  }

  if (String(user.gender).trim().toLowerCase() !== "male") {
    return {
      ...config,
      eligible: false,
      reason: "not_male",
      balance: 0,
    };
  }

  if (!user.profileCompleted) {
    return {
      ...config,
      eligible: false,
      reason: "profile_incomplete",
      balance: 0,
    };
  }

  const wallet = await Wallet.findOne({
    where: { userId },
    attributes: ["balance"],
  });
  const balance = Number(wallet?.balance ?? 0);
  const threshold = Number(settings.lowBalanceThreshold) || 20;

  if (balance >= threshold) {
    return {
      ...config,
      eligible: false,
      reason: "balance_sufficient",
      balance,
    };
  }

  return {
    ...config,
    eligible: true,
    reason: null,
    balance,
  };
};
