import { Request, Response, NextFunction } from "express";
import { logger } from "../../lib/observability/logger";

export interface AuditEvent {
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  result: "success" | "failure";
  statusCode: number;
  durationMs: number;
  timestamp: number;
}

type AuditSink = (event: AuditEvent) => void | Promise<void>;
let auditSink: AuditSink | null = null;

export function setAuditSink(sink: AuditSink) {
  auditSink = sink;
}

/** Map HTTP method + path to a human-readable action name. */
function deriveAction(method: string, path: string): { action: string; resource: string } {
  if (method === "POST" && path.includes("/agent/execute")) return { action: "agent.execute", resource: "agent" };
  if (method === "PUT" && path.includes("/agent/execute")) return { action: "agent.resume", resource: "agent" };
  if (method === "POST" && path.includes("/auth/login")) return { action: "auth.login", resource: "auth" };
  if (method === "POST" && path.includes("/auth/logout")) return { action: "auth.logout", resource: "auth" };
  if (method === "GET" && path.includes("/admin/costs")) return { action: "admin.costs.read", resource: "costs" };
  if (method === "GET" && path.includes("/admin/audit")) return { action: "admin.audit.read", resource: "audit_logs" };
  return { action: `${method.toLowerCase()}.${path.split("/").filter(Boolean).join(".")}`, resource: "api" };
}

/**
 * Express middleware that logs every authenticated API request as an audit event.
 * Attach AFTER requireAuth so req.user is populated.
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return next(); // Only audit authenticated requests

  const start = Date.now();
  const { action, resource } = deriveAction(req.method, req.path);
  const resourceId = (req.body?.conversationId as string | undefined) || (req.params?.id as string | undefined);

  res.on("finish", () => {
    const event: AuditEvent = {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action,
      resource,
      resourceId,
      metadata: { method: req.method, path: req.path, query: req.query },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      result: res.statusCode < 400 ? "success" : "failure",
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    };

    logger.info(
      { requestId: req.requestId, userId: event.userId, action: event.action, statusCode: event.statusCode, durationMs: event.durationMs },
      "[audit]"
    );

    auditSink?.(event);
  });

  next();
}

/** Convenience helper to log explicit events from route handlers. */
export function logAuditEvent(
  req: Request,
  action: string,
  resource: string,
  result: "success" | "failure",
  extra?: Record<string, unknown>
) {
  const event: AuditEvent = {
    userId: req.user?.id || "anonymous",
    userEmail: req.user?.email || "anonymous",
    action,
    resource,
    resourceId: extra?.resourceId as string | undefined,
    metadata: extra,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    result,
    statusCode: result === "success" ? 200 : 400,
    durationMs: 0,
    timestamp: Date.now(),
  };
  logger.info({ userId: event.userId, action: event.action, result }, "[audit] explicit event");
  auditSink?.(event);
}
