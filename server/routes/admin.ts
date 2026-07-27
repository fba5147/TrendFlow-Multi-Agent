/**
 * Admin API Routes
 *
 * All routes require: requireAuth + requireRole("admin")
 *
 * GET /api/admin/health      - Health check (public)
 * GET /api/admin/costs       - LLM cost summary
 * GET /api/admin/audit       - Recent audit log entries
 * GET /api/admin/models      - Supported models + pricing
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getCostSummary, MODEL_COSTS } from "../../lib/observability/cost";
import { logger } from "../../lib/observability/logger";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export const adminRouter = Router();

// --- Models + pricing (public endpoint, useful for UI) ---
adminRouter.get("/models", (_req: Request, res: Response) => {
  const models = Object.entries(MODEL_COSTS).map(([model, pricing]) => ({
    model,
    inputPricePerMillion: pricing.input,
    outputPricePerMillion: pricing.output,
    free: pricing.input === 0 && pricing.output === 0,
  }));
  res.json({ models });
});

// --- Cost summary ---
adminRouter.get("/costs", requireAuth, requireRole("admin"), (_req: Request, res: Response) => {
  const summary = getCostSummary();
  logger.info({ totalUsd: summary.totalUsd }, "[admin] Cost summary requested");
  res.json(summary);
});

// --- Audit log ---
adminRouter.get("/audit", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return res.status(503).json({ error: "Convex not configured. Audit log unavailable." });
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const logs = await client.query(api.queries.getAuditLogs, { limit });
    res.json({ logs, count: logs.length });
  } catch (err) {
    logger.error({ err }, "[admin] Failed to fetch audit logs");
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

// --- System info (admin only) ---
adminRouter.get("/system", requireAuth, requireRole("admin"), (_req: Request, res: Response) => {
  res.json({
    nodeVersion: process.version,
    uptime: process.uptime(),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    env: process.env.NODE_ENV || "development",
    authEnabled: process.env.AUTH_ENABLED !== "false",
    llmProvider: process.env.LLM_PROVIDER || "groq",
  });
});
