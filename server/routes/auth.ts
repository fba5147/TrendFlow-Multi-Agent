/**
 * OAuth 2.0 Authentication Routes
 *
 * Supported providers: GitHub, Google
 * Flow: GET /api/auth/:provider → redirect to provider → GET /api/auth/:provider/callback → JWT
 *
 * Environment variables:
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   JWT_SECRET, JWT_EXPIRES_IN (default: 7d)
 *   OAUTH_CALLBACK_BASE_URL (e.g. http://localhost:3001)
 *   FRONTEND_URL (e.g. http://localhost:3000)
 */
import { Router, Request, Response } from "express";
import { signToken } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import { logger } from "../../lib/observability/logger";

export const authRouter = Router();

// --- State store (in-memory; replace with Redis for multi-instance) ---
const oauthStates = new Map<string, { provider: string; expiresAt: number }>();

function generateState(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
}

function getCallbackUrl(provider: string): string {
  const base = process.env.OAUTH_CALLBACK_BASE_URL || "http://localhost:3001";
  return `${base}/api/auth/${provider}/callback`;
}

// --- GitHub ---

authRouter.get("/github", authRateLimiter, (req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return res.status(501).json({ error: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET." });

  const state = generateState();
  oauthStates.set(state, { provider: "github", expiresAt: Date.now() + 10 * 60 * 1000 });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl("github"),
    scope: "read:user user:email",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

authRouter.get("/github/callback", authRateLimiter, async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  if (error) return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);

  const stateData = oauthStates.get(state);
  if (!stateData || stateData.expiresAt < Date.now() || stateData.provider !== "github") {
    return res.redirect(`${frontendUrl}/login?error=invalid_state`);
  }
  oauthStates.delete(state);

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: getCallbackUrl("github"),
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) throw new Error(tokenData.error || "No access token");

    // Fetch user profile
    const [userRes, emailsRes] = await Promise.all([
      fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" } }),
      fetch("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" } }),
    ]);
    const ghUser = (await userRes.json()) as { id: number; login: string; name?: string; avatar_url?: string; email?: string };
    const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
    const primaryEmail = emails.find((e) => e.primary && e.verified)?.email || ghUser.email || "";

    const user = await upsertUser("github", String(ghUser.id), primaryEmail, ghUser.name || ghUser.login, ghUser.avatar_url);
    const token = signToken(user);

    logger.info({ userId: user.id, provider: "github" }, "[auth] GitHub login success");
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  } catch (err) {
    logger.error({ err }, "[auth] GitHub callback error");
    res.redirect(`${frontendUrl}/login?error=github_auth_failed`);
  }
});

// --- Google ---

authRouter.get("/google", authRateLimiter, (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(501).json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });

  const state = generateState();
  oauthStates.set(state, { provider: "google", expiresAt: Date.now() + 10 * 60 * 1000 });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl("google"),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRouter.get("/google/callback", authRateLimiter, async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  if (error) return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);

  const stateData = oauthStates.get(state);
  if (!stateData || stateData.expiresAt < Date.now() || stateData.provider !== "google") {
    return res.redirect(`${frontendUrl}/login?error=invalid_state`);
  }
  oauthStates.delete(state);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: getCallbackUrl("google"),
        grant_type: "authorization_code",
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) throw new Error(tokenData.error || "No access token");

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = (await profileRes.json()) as { id: string; email: string; name: string; picture?: string };

    const user = await upsertUser("google", profile.id, profile.email, profile.name, profile.picture);
    const token = signToken(user);

    logger.info({ userId: user.id, provider: "google" }, "[auth] Google login success");
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  } catch (err) {
    logger.error({ err }, "[auth] Google callback error");
    res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
  }
});

// --- Current user ---

authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// --- Logout (client-side; just confirm) ---

authRouter.post("/logout", requireAuth, (req: Request, res: Response) => {
  logger.info({ userId: req.user?.id }, "[auth] Logout");
  res.json({ success: true, message: "Logged out. Delete your token on the client." });
});

// --- User upsert helper ---
// Stores users in Convex. The Convex mutation is called server-side using HTTP client.

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { AuthUser } from "../middleware/auth";

let convex: ConvexHttpClient | null = null;

function getConvex(): ConvexHttpClient | null {
  if (!convex) {
    const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
    if (url) convex = new ConvexHttpClient(url);
  }
  return convex;
}

const localUserStore = new Map<string, AuthUser>(); // Fallback when Convex is unavailable

async function upsertUser(
  provider: "github" | "google",
  oauthId: string,
  email: string,
  name: string,
  avatarUrl?: string
): Promise<AuthUser> {
  const client = getConvex();
  if (client) {
    try {
      const result = await client.mutation(api.mutations.upsertUser, {
        oauthProvider: provider,
        oauthId,
        email,
        name,
        avatarUrl,
      });
      return { id: result.id, email: result.email, name: result.name, role: result.role };
    } catch (err) {
      logger.warn({ err }, "[auth] Convex upsertUser failed, using local store");
    }
  }

  // Fallback: in-memory store (dev/no-Convex mode)
  const key = `${provider}:${oauthId}`;
  const existing = localUserStore.get(key);
  if (existing) {
    localUserStore.set(key, { ...existing, email, name });
    return existing;
  }
  const newUser: AuthUser = {
    id: `local-${provider}-${oauthId}`,
    email,
    name,
    role: localUserStore.size === 0 ? "admin" : "editor", // First user is admin
  };
  localUserStore.set(key, newUser);
  return newUser;
}
