import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { agentRouter } from "./routes/agent";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { apiRateLimiter } from "./middleware/rateLimiter";
import { setAuditSink } from "./middleware/audit";
import { setCostFlushHandler, flushCosts } from "../lib/observability/cost";
import { logger } from "../lib/observability/logger";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const app = express();
const PORT = process.env.PORT || 3001;

// ---- Convex client for audit + cost sinks ----
const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null;

if (convex) {
  setAuditSink(async (event) => {
    try {
      await convex.mutation(api.mutations.writeAuditLog, event);
    } catch (err) {
      logger.warn({ err }, "[audit] Failed to write audit log to Convex");
    }
  });

  setCostFlushHandler(async (events) => {
    try {
      await convex.mutation(api.mutations.writeCostEvents, { events });
    } catch (err) {
      logger.warn({ err }, "[cost] Failed to flush cost events to Convex");
    }
  });
}

// ---- Security headers ----
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Vite requires inline scripts in dev
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.convex.cloud", "wss://"],
      },
    },
    crossOriginEmbedderPolicy: false, // Needed for some frontend assets
  })
);

// ---- CORS ----
const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors({
    origin: corsOrigin || (process.env.NODE_ENV === "production" ? false : true),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ---- Request ID ----
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.requestId = (req.headers["x-request-id"] as string) || randomUUID();
  next();
});

// ---- Structured HTTP logging ----
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({ requestId: (req as Request).requestId }),
    customLogLevel: (_req, res) => (res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    redact: ["req.headers.authorization"],
  })
);

// ---- Body parsing ----
app.use(express.json({ limit: "1mb" }));

// ---- Health check (unauthenticated, before rate limiter) ----
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: process.env.npm_package_version || "0.2.0",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ---- Rate limiting ----
app.use("/api", apiRateLimiter);

// ---- API routes ----
app.use("/api/auth", authRouter);
app.use("/api/agent", agentRouter);
app.use("/api/admin", adminRouter);

// ---- 404 for unmatched API routes ----
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "API route not found" });
});

// ---- Serve Vite production build ----
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ---- Global error handler ----
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "[server] Unhandled error");
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ---- Start ----
const server = app.listen(PORT, () => {
  logger.info(
    { port: PORT, env: process.env.NODE_ENV, auth: process.env.AUTH_ENABLED !== "false" },
    `TrendFlow server running on http://localhost:${PORT}`
  );
});

// ---- Graceful shutdown ----
function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received");
  flushCosts();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
