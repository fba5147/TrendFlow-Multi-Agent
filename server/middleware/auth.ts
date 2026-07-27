import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../../lib/observability/logger";

export interface AuthUser {
  id: string;       // Convex user._id
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.warn("[auth] JWT_SECRET is not set — authentication is DISABLED. Set JWT_SECRET in .env for production.");
    return "dev-insecure-secret-change-in-production";
  }
  return secret;
}

/** Strict auth — returns 401 if no valid token. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Allow bypass in dev when AUTH_ENABLED=false
  if (process.env.AUTH_ENABLED === "false") {
    req.user = { id: "dev-user", email: "dev@localhost", name: "Dev User", role: "admin" };
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header. Expected: Bearer <token>" });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    req.user = {
      id: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as AuthUser["role"],
    };
    next();
  } catch (err) {
    const message = err instanceof jwt.TokenExpiredError ? "Token expired" : "Invalid token";
    logger.warn({ requestId: req.requestId, err }, `[auth] ${message}`);
    return res.status(401).json({ error: message });
  }
}

/** Optional auth — populates req.user if a valid token is present, never blocks. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  if (process.env.AUTH_ENABLED === "false") {
    req.user = { id: "dev-user", email: "dev@localhost", name: "Dev User", role: "admin" };
    return next();
  }

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), getJwtSecret()) as jwt.JwtPayload;
      req.user = {
        id: payload.sub as string,
        email: payload.email as string,
        name: payload.name as string,
        role: payload.role as AuthUser["role"],
      };
    } catch {
      // Ignore invalid tokens in optional mode
    }
  }
  next();
}

/** Sign a JWT for a verified user. */
export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    getJwtSecret(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as any }
  );
}
