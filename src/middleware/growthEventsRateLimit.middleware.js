const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;

const buckets = new Map();

const pruneBuckets = (now) => {
  if (buckets.size <= 5000) {
    return;
  }
  for (const [key, entry] of buckets.entries()) {
    if (now - entry.startMs > WINDOW_MS) {
      buckets.delete(key);
    }
  }
};

export const growthEventsRateLimit = (req, res, next) => {
  const now = Date.now();
  const key =
    String(req.headers["x-forwarded-for"] || req.ip || "unknown")
      .split(",")[0]
      .trim() || "unknown";

  pruneBuckets(now);

  const current = buckets.get(key);
  if (!current || now - current.startMs > WINDOW_MS) {
    buckets.set(key, { startMs: now, count: 1 });
    return next();
  }

  current.count += 1;
  if (current.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      message: "Too many event requests. Please retry later.",
    });
  }

  return next();
};
