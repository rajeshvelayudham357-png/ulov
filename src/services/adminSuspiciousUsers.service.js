import { QueryTypes } from "sequelize";

import { sequelize } from "../config/database.js";
import {
  getAdminUserDisplayName,
  isAdminProfilePending,
} from "./adminUsers.service.js";

const PREFIX_MIN_ACCOUNTS = 3;

const KNOWN_FAKE_PHONES = new Set([
  "6666666666",
  "666666666",
  "6969696969",
  "696969696",
  "9999999999",
  "999999999",
  "8888888888",
  "7777777777",
  "1234567890",
  "0123456789",
  "9876543210",
  "1111111111",
  "0000000000",
]);

export const normalizePhoneDigits = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
};

export const getPhoneSuspicionReasons = (phone) => {
  const raw = String(phone || "").trim();
  const digits = normalizePhoneDigits(raw);
  const reasons = [];

  if (!raw) {
    return reasons;
  }

  if (digits.length > 0 && digits.length < 10) {
    reasons.push("invalid_length");
  }

  if (digits.length === 10) {
    if (/^(\d)\1{9}$/.test(digits)) {
      reasons.push("repeated_digit");
    }
    if (/^(\d{2})\1{4}$/.test(digits)) {
      reasons.push("repeated_pair");
    }
    if (/^(0123456789|1234567890|9876543210)$/.test(digits)) {
      reasons.push("sequential");
    }
    if (KNOWN_FAKE_PHONES.has(digits)) {
      reasons.push("known_fake");
    }
  } else if (digits.length === 9) {
    if (/^(\d)\1{8}$/.test(digits)) {
      reasons.push("repeated_digit");
    }
    if (/^(\d{2})\1{3}\d$/.test(digits) || /^(\d{2})\1{4}$/.test(digits)) {
      reasons.push("repeated_pair");
    }
    if (KNOWN_FAKE_PHONES.has(digits)) {
      reasons.push("known_fake");
    }
  }

  if (
    /666666666/.test(raw.replace(/\D/g, "")) ||
    /696969696/.test(raw.replace(/\D/g, ""))
  ) {
    if (!reasons.includes("known_fake")) {
      reasons.push("known_fake");
    }
  }

  return reasons;
};

const paginate = (page, limit, max = 100) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), max);
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
};

const reasonLabel = (key) => {
  const labels = {
    invalid_length: "Invalid length",
    repeated_digit: "Repeated digits",
    repeated_pair: "Repeated digit pair",
    sequential: "Sequential number",
    known_fake: "Known fake pattern",
    shared_prefix_5: "Same first 5 digits",
    shared_prefix_6: "Same first 6 digits",
    shared_prefix_7: "Same first 7 digits",
    shared_prefix_8: "Same first 8 digits",
    shared_prefix_9: "Same first 9 digits",
    duplicate_phone: "Duplicate phone",
    pending_profile: "Pending profile",
  };
  return labels[key] || key;
};

export const isPendingProfileUser = (row) => isAdminProfilePending(row);

const loadPrefixCounts = async () => {
  const rows = await sequelize.query(
    `SELECT u.id,
            u.phone
     FROM users u
     WHERE COALESCE(u.accountStatus, '') <> 'deleted'
       AND TRIM(COALESCE(u.phone, '')) <> ''`,
    { type: QueryTypes.SELECT }
  );

  const prefix5 = new Map();
  const prefix6 = new Map();
  const prefix7 = new Map();
  const prefix8 = new Map();
  const prefix9 = new Map();
  const phoneCounts = new Map();

  for (const row of rows) {
    const digits = normalizePhoneDigits(row.phone);
    if (digits.length !== 10) {
      continue;
    }

    const p5 = digits.slice(0, 5);
    const p6 = digits.slice(0, 6);
    const p7 = digits.slice(0, 7);
    const p8 = digits.slice(0, 8);
    const p9 = digits.slice(0, 9);
    prefix5.set(p5, (prefix5.get(p5) || 0) + 1);
    prefix6.set(p6, (prefix6.get(p6) || 0) + 1);
    prefix7.set(p7, (prefix7.get(p7) || 0) + 1);
    prefix8.set(p8, (prefix8.get(p8) || 0) + 1);
    prefix9.set(p9, (prefix9.get(p9) || 0) + 1);
    phoneCounts.set(digits, (phoneCounts.get(digits) || 0) + 1);
  }

  const hotFromMap = (map) =>
    new Set(
      [...map.entries()]
        .filter(([, count]) => count >= PREFIX_MIN_ACCOUNTS)
        .map(([key]) => key)
    );

  const hotPrefix5 = hotFromMap(prefix5);
  const hotPrefix6 = hotFromMap(prefix6);
  const hotPrefix7 = hotFromMap(prefix7);
  const hotPrefix8 = hotFromMap(prefix8);
  const hotPrefix9 = hotFromMap(prefix9);
  const duplicatePhones = new Set(
    [...phoneCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([phone]) => phone)
  );

  return {
    hotPrefix5,
    hotPrefix6,
    hotPrefix7,
    hotPrefix8,
    hotPrefix9,
    duplicatePhones,
  };
};

const buildSuspiciousUsers = async ({
  search = "",
  gender = "all",
  reason = "all",
} = {}) => {
  const rows = await sequelize.query(
    `SELECT u.id,
            u.publicUserId,
            u.name,
            u.nickname,
            u.username,
            u.phone,
            u.gender,
            u.accountStatus,
            u.profileCompleted,
            u.verified,
            u.blocked,
            u.online,
            u.createdAt,
            u.lastLoginAt,
            u.lastSeen,
            u.updatedAt
     FROM users u
     WHERE COALESCE(u.accountStatus, '') <> 'deleted'
       AND (
         TRIM(COALESCE(u.phone, '')) <> ''
         OR COALESCE(u.profileCompleted, 0) = 0
       )
       AND (
         LOWER(COALESCE(u.gender, '')) IN ('male', 'female')
         OR u.gender IS NULL
       )
     ORDER BY u.createdAt DESC`,
    { type: QueryTypes.SELECT }
  );

  const {
    hotPrefix5,
    hotPrefix6,
    hotPrefix7,
    hotPrefix8,
    hotPrefix9,
    duplicatePhones,
  } = await loadPrefixCounts();

  let suspicious = [];

  for (const row of rows) {
    const phoneDigits = normalizePhoneDigits(row.phone);
    const reasons =
      String(row.phone || "").trim() !== ""
        ? getPhoneSuspicionReasons(row.phone)
        : [];

    if (isPendingProfileUser(row)) {
      reasons.push("pending_profile");
    }

    if (phoneDigits.length === 10) {
      const p5 = phoneDigits.slice(0, 5);
      const p6 = phoneDigits.slice(0, 6);
      const p7 = phoneDigits.slice(0, 7);
      const p8 = phoneDigits.slice(0, 8);
      const p9 = phoneDigits.slice(0, 9);
      if (hotPrefix5.has(p5)) {
        reasons.push("shared_prefix_5");
      }
      if (hotPrefix6.has(p6)) {
        reasons.push("shared_prefix_6");
      }
      if (hotPrefix7.has(p7)) {
        reasons.push("shared_prefix_7");
      }
      if (hotPrefix8.has(p8)) {
        reasons.push("shared_prefix_8");
      }
      if (hotPrefix9.has(p9)) {
        reasons.push("shared_prefix_9");
      }
      if (duplicatePhones.has(phoneDigits)) {
        reasons.push("duplicate_phone");
      }
    }

    const uniqueReasons = [...new Set(reasons)];
    if (uniqueReasons.length === 0) {
      continue;
    }

    const genderValue = String(row.gender || "").trim().toLowerCase();
    if (gender === "male" && genderValue !== "male") {
      continue;
    }
    if (gender === "female" && genderValue !== "female") {
      continue;
    }

    if (reason !== "all" && !uniqueReasons.includes(reason)) {
      continue;
    }

    const searchTerm = String(search || "").trim().toLowerCase();
    if (searchTerm) {
      const haystack = [
        row.id,
        row.publicUserId,
        row.name,
        row.nickname,
        row.username,
        row.phone,
        phoneDigits,
        ...uniqueReasons.map(reasonLabel),
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      if (!haystack.some((value) => value.includes(searchTerm))) {
        continue;
      }
    }

    suspicious.push({
      id: Number(row.id),
      publicUserId: row.publicUserId || null,
      displayName: getAdminUserDisplayName(row),
      phone: row.phone || "",
      phoneDigits: phoneDigits || null,
      gender: row.gender || "—",
      accountStatus: row.accountStatus || "—",
      profileCompleted: !isAdminProfilePending(row),
      verified: Boolean(row.verified),
      blocked: Boolean(row.blocked),
      online: Boolean(row.online),
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt || null,
      lastSeen: row.lastSeen || null,
      updatedAt: row.updatedAt || null,
      reasons: uniqueReasons,
      reasonLabels: uniqueReasons.map(reasonLabel),
      prefix5: phoneDigits.length === 10 ? phoneDigits.slice(0, 5) : null,
      prefix6: phoneDigits.length === 10 ? phoneDigits.slice(0, 6) : null,
      prefix7: phoneDigits.length === 10 ? phoneDigits.slice(0, 7) : null,
      prefix8: phoneDigits.length === 10 ? phoneDigits.slice(0, 8) : null,
      prefix9: phoneDigits.length === 10 ? phoneDigits.slice(0, 9) : null,
    });
  }

  suspicious.sort((a, b) => {
    const score = (item) => item.reasons.length * 10 + (item.blocked ? 0 : 1);
    return score(b) - score(a) || String(b.createdAt).localeCompare(String(a.createdAt));
  });

  return suspicious;
};

export const getAdminSuspiciousUserIdsForFilters = async (filters = {}) => {
  const suspicious = await buildSuspiciousUsers(filters);
  return suspicious.map((row) => row.id);
};

export const getAdminSuspiciousUsersList = async ({
  page = 1,
  limit = 25,
  search = "",
  gender = "all",
  reason = "all",
} = {}) => {
  const { page: safePage, limit: safeLimit, offset } = paginate(page, limit);
  const suspicious = await buildSuspiciousUsers({ search, gender, reason });

  const total = suspicious.length;
  const pageRows = suspicious.slice(offset, offset + safeLimit);

  const summary = {
    total,
    male: suspicious.filter((row) => String(row.gender).toLowerCase() === "male")
      .length,
    female: suspicious.filter((row) => String(row.gender).toLowerCase() === "female")
      .length,
    byReason: suspicious.reduce((acc, row) => {
      for (const key of row.reasons) {
        acc[key] = (acc[key] || 0) + 1;
      }
      return acc;
    }, {}),
  };

  return {
    rows: pageRows,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    summary,
    reasonOptions: [
      { key: "known_fake", label: reasonLabel("known_fake") },
      { key: "repeated_digit", label: reasonLabel("repeated_digit") },
      { key: "repeated_pair", label: reasonLabel("repeated_pair") },
      { key: "sequential", label: reasonLabel("sequential") },
      { key: "invalid_length", label: reasonLabel("invalid_length") },
      { key: "shared_prefix_5", label: reasonLabel("shared_prefix_5") },
      { key: "shared_prefix_6", label: reasonLabel("shared_prefix_6") },
      { key: "shared_prefix_7", label: reasonLabel("shared_prefix_7") },
      { key: "shared_prefix_8", label: reasonLabel("shared_prefix_8") },
      { key: "shared_prefix_9", label: reasonLabel("shared_prefix_9") },
      { key: "duplicate_phone", label: reasonLabel("duplicate_phone") },
      { key: "pending_profile", label: reasonLabel("pending_profile") },
    ],
  };
};
