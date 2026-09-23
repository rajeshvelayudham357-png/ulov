import jwt from "jsonwebtoken";

/** Returns authenticated user id from Bearer JWT, or null. */
export const resolveAuthenticatedUserIdFromRequest = (req) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length < 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  try {
    const decoded = jwt.verify(parts[1], process.env.JWT_SECRET);
    const userId = Number(decoded?.id);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
};
