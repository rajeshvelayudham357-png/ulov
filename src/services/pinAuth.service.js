import bcrypt from "bcrypt";

export const PIN_LENGTH = 4;

export const normalizePin = (value) =>
  String(value ?? "").replace(/\D/g, "");

export const isValidPin = (pin) => {
  const normalized = normalizePin(pin);
  return (
    normalized.length === PIN_LENGTH &&
    /^\d{4}$/.test(normalized)
  );
};

export const hashPin = async (pin) => {
  const normalized = normalizePin(pin);
  return bcrypt.hash(normalized, 10);
};

export const verifyPinHash = async (pin, hash) => {
  if (!hash) {
    return false;
  }

  const normalized = normalizePin(pin);
  return bcrypt.compare(normalized, hash);
};
