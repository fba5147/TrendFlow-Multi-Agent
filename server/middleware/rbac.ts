import { Request, Response, NextFunction } from "express";

const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

/**
 * Require at least the given role. Roles are hierarchical:
 *   admin > editor > viewer
 *
 * Usage:
 *   router.post("/execute", requireAuth, requireRole("editor"), handler)
 *   router.get("/admin/costs", requireAuth, requireRole("admin"), handler)
 */
export function requireRole(minimumRole: "admin" | "editor" | "viewer") {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const userLevel = ROLE_HIERARCHY[user.role] ?? -1;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 99;
    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: `Insufficient permissions. Required: ${minimumRole}, your role: ${user.role}`,
      });
    }
    next();
  };
}
