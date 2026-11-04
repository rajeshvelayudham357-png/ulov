import authMiddleware from "./authMiddleware.js";

/**
 * Auth for POST /api/call/create.
 *
 * App builds released before the Phase 1 billing fixes call this endpoint
 * without a token. In `optional` mode (default) such requests keep working and
 * act as the `callerId` in the body, exactly as before. Requests that carry a
 * token are always verified. Set CALL_CREATE_AUTH_MODE=required once the build
 * that sends the token is the minimum supported version.
 */
export const getCallCreateAuthMode = () =>
  String(process.env.CALL_CREATE_AUTH_MODE || "").trim().toLowerCase() === "required"
    ? "required"
    : "optional";

const callCreateAuth = (req, res, next) => {
  if (req.headers.authorization || getCallCreateAuthMode() === "required") {
    return authMiddleware(req, res, next);
  }

  const callerId = Number(req.body?.callerId);

  if (!Number.isInteger(callerId) || callerId <= 0) {
    return res.status(401).json({ message: "Token missing" });
  }

  console.log("LEGACY CALL CREATE WITHOUT TOKEN", { callerId });
  req.user = { id: callerId, legacy: true };
  return next();
};

export default callCreateAuth;
