/** Extract UTM / referral attribution fields from request body or query. */
export const extractGrowthAttribution = (req = {}) => {
  const source = req.body ?? {};
  const query = req.query ?? {};

  const pick = (key) => {
    const value = source[key] ?? source[key.toLowerCase()] ?? query[key] ?? query[key.toLowerCase()];
    if (value === null || value === undefined) {
      return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed || undefined;
  };

  return {
    source: pick("source") ?? pick("utm_source"),
    medium: pick("medium") ?? pick("utm_medium"),
    campaign: pick("campaign") ?? pick("utm_campaign"),
    term: pick("term") ?? pick("utm_term"),
    content: pick("content") ?? pick("utm_content"),
    referralCode: pick("referralCode") ?? pick("referral_code"),
    referrerUserId: pick("referrerUserId") ?? pick("referrer_user_id"),
    anonymousId: pick("anonymousId") ?? pick("anonymous_id") ?? pick("installId"),
    installId: pick("installId") ?? pick("install_id"),
    sessionId: pick("sessionId") ?? pick("session_id"),
    platform: pick("platform"),
    appVersion: pick("appVersion") ?? pick("app_version"),
    deviceType: pick("deviceType") ?? pick("device_type"),
    os: pick("os"),
    country: pick("country"),
    language: pick("language"),
  };
};
