import {
  applyReferralCode,
  getFemaleReferralOverview,
  getMaleReferralStatus,
  getReferralSettings,
  listReferralsForAdmin,
  updateReferralSettings,
} from "../services/referral.service.js";

const sendError = (res, error, fallback) =>
  res.status(error?.statusCode || 500).json({
    message: error?.message || fallback,
  });

export const getMyReferralOverview = async (req, res) => {
  try {
    return res.json(
      await getFemaleReferralOverview({
        userId: Number(req.user?.id),
        page: req.query.page,
        limit: req.query.limit,
      })
    );
  } catch (error) {
    return sendError(res, error, "Unable to load referrals");
  }
};

export const getMyReferralStatus = async (req, res) => {
  try {
    return res.json(await getMaleReferralStatus(Number(req.user?.id)));
  } catch (error) {
    return sendError(res, error, "Unable to load referral status");
  }
};

export const applyMyReferralCode = async (req, res) => {
  try {
    return res.json(
      await applyReferralCode({ userId: Number(req.user?.id), code: req.body?.code })
    );
  } catch (error) {
    return sendError(res, error, "Unable to apply referral code");
  }
};

export const getReferralSettingsAdmin = async (req, res) => {
  try {
    return res.json(await getReferralSettings());
  } catch (error) {
    return sendError(res, error, "Unable to load referral settings");
  }
};

export const updateReferralSettingsAdmin = async (req, res) => {
  try {
    const settings = await updateReferralSettings(req.body || {});
    return res.json({ message: "Referral settings updated", settings });
  } catch (error) {
    return res.status(error?.statusCode || 400).json({ message: error.message });
  }
};

export const listReferralsAdmin = async (req, res) => {
  try {
    return res.json(
      await listReferralsForAdmin({
        page: req.query.page,
        limit: req.query.limit,
        status: req.query.status,
        search: req.query.search,
      })
    );
  } catch (error) {
    return sendError(res, error, "Unable to load referrals");
  }
};
