import { createTranslator } from "../constants/supportAssistantI18n.js";

export const TIMEZONE = "Asia/Kolkata";
export const HOUR_MS = 60 * 60 * 1000;

export const formatRupees = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** English date for ticket summaries read by the support team. */
export const englishDateTime = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

export const startOfTodayIst = (now) => {
  const offsetMs = 330 * 60000;
  const local = new Date(now.getTime() + offsetMs);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMs);
};

export const reply = ({
  topic,
  intent,
  messages,
  resolution,
  escalation = { allowed: false },
  suggestions = [],
  summary = [],
}) => ({ topic, intent, messages, resolution, escalation, suggestions, summary });

/** Per-request helpers bound to the user's language. */
export const createContext = ({ user, now, language, deps = {} }) => {
  const t = createTranslator(language);
  const locale = `${language}-IN`;

  const dateTime = (value) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: TIMEZONE,
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(value));

  const date = (value) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: TIMEZONE,
      day: "numeric",
      month: "short",
    }).format(new Date(value));

  const duration = (ms) => {
    const totalMinutes = Math.max(1, Math.round(ms / 60000));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (h === 0) {
      return t("dur.min", { m });
    }

    return m ? t("dur.hm", { h, m }) : t("dur.h", { h });
  };

  return {
    user,
    now,
    language,
    deps,
    t,
    dateTime,
    date,
    duration,
    kycLabel: (kyc) => (!kyc?.status ? t("kyc.none") : t(`kyc.${kyc.status}`)),
    callTypeLabel: (type) =>
      ["voice", "audio"].includes(String(type).toLowerCase()) ? t("val.voice") : t("val.video"),
    text: (value) => ({ type: "text", text: value }),
    card: (title, rows, tone = "neutral") => ({ type: "card", title, tone, rows }),
    row: (label, value, tone = "neutral") => ({ label, value: String(value), tone }),
    suggestion: (topic, intent, labelKey) => ({ topic, intent, label: t(labelKey) }),
  };
};
