const buckets = new Map();

const rateLimit = ({ windowMs, max, key = (req) => req.ip }) => (req, res, next) => {
  const now = Date.now();
  const bucketKey = `${req.method}:${req.path}:${key(req)}`;
  const bucket = buckets.get(bucketKey);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return next();
  }
  bucket.count += 1;
  if (bucket.count <= max) return next();
  res.set("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
  return res.status(429).send("Too many requests. Please wait a few minutes and try again.");
};

module.exports = rateLimit;
