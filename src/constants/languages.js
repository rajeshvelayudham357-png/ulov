import {
  normalizeLanguage,
  parseLanguages,
} from "../services/appSettings.service.js";

export const FEMALE_LANGUAGE_OPTIONS = [
  "English",
  "Tamil",
  "Hindi",
  "Telugu",
  "Malayalam",
  "Kannada",
  "Marathi",
  "Bengali",
  "Gujarati",
  "Punjabi",
];

export const getFirstLanguage = (languages) => {
  const parsed = parseLanguages(languages);
  return parsed[0] || null;
};

export const matchesFirstLanguage = (userLanguages, filterLanguage) => {
  const normalizedFilter = normalizeLanguage(filterLanguage);

  if (!normalizedFilter) {
    return true;
  }

  const firstLanguage = getFirstLanguage(userLanguages);

  if (!firstLanguage) {
    return false;
  }

  return firstLanguage === normalizedFilter;
};

export const formatLanguageLabel = (language) => {
  const normalized = normalizeLanguage(language);

  if (!normalized) {
    return "";
  }

  return (
    FEMALE_LANGUAGE_OPTIONS.find(
      (option) => normalizeLanguage(option) === normalized
    ) || String(language).trim()
  );
};
