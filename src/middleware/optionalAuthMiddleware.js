import jwt from "jsonwebtoken";

const optionalAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return next();
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
  } catch (error) {
    // Ignore invalid tokens for public endpoints that support optional auth.
  }

  return next();
};

export default optionalAuthMiddleware;
