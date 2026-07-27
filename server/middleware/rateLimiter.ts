import rateLimit from "express-rate-limit";
import { logger } from "../../lib/observability/logger";

/** General API rate limiter: 100 requests per 15 minutes per IP. */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait before retrying." },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip, path: req.path }, "[rate-limit] API limit exceeded");
    res.status(429).json(options.message);
  },
  skip: () => process.env.AUTH_ENABLED === "false",
});

/** Stricter limiter for auth endpoints: 10 requests per 15 minutes per IP. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please wait 15 minutes." },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip }, "[rate-limit] Auth limit exceeded");
    res.status(429).json(options.message);
  },
  skip: () => process.env.AUTH_ENABLED === "false",
});

/** Agent execution limiter: 20 runs per hour per authenticated user. */
export const agentRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip || "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Agent execution limit reached (20 runs/hour). Upgrade your plan for higher limits." },
  skip: () => process.env.AUTH_ENABLED === "false",
});
