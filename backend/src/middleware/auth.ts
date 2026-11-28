import type { Context, Next } from "hono";
import { verifyJWT } from "../utils/jwt.ts";
import type { JWTPayload } from "../utils/jwt.ts";
import type { Action, Resource, UserWithPermissions } from "../types/index.ts";
import { getDatabase } from "../database/init.ts";

// ---- Context helpers ----

/**
 * After requireAuth runs, the authenticated user is available on the Hono context.
 * Use `getAuthUser(c)` in route handlers to retrieve it.
 */
export function getAuthUser(c: Context): UserWithPermissions {
  return c.get("authUser") as UserWithPermissions;
}

// ---- Response helpers ----

function unauthorized(message = "Unauthorized"): Response {
  return new Response(message, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Bearer realm="Invio"',
    },
  });
}

function forbidden(message = "Forbidden"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

// ---- User lookup from DB ----

function loadUserWithPermissions(
  userId: string,
  username?: string,
): UserWithPermissions | null {
  const db = getDatabase();

  // Support legacy tokens that only have a username, no real userId
  let rows;
  if (userId === "__legacy__" && username) {
    rows = db.query(
      "SELECT id, username, email, display_name, is_admin, is_active, two_factor_enabled, created_at, updated_at FROM users WHERE username = ?",
      [username],
    );
  } else {
    rows = db.query(
      "SELECT id, username, email, display_name, is_admin, is_active, two_factor_enabled, created_at, updated_at FROM users WHERE id = ?",
      [userId],
    );
  }

  if (rows.length === 0) return null;

  const row = rows[0] as unknown[];
  const user: UserWithPermissions = {
    id: String(row[0]),
    username: String(row[1]),
    email: row[2] ? String(row[2]) : undefined,
    displayName: row[3] ? String(row[3]) : undefined,
    isAdmin: Boolean(row[4]),
    isActive: Boolean(row[5]),
    twoFactorEnabled: Boolean(row[6]),
    createdAt: new Date(String(row[7])),
    updatedAt: new Date(String(row[8])),
    permissions: [],
  };

  // Load permissions
  const permRows = db.query(
    "SELECT resource, action FROM user_permissions WHERE user_id = ?",
    [user.id],
  );
  user.permissions = permRows.map((pr) => ({
    resource: String((pr as unknown[])[0]) as Resource,
    action: String((pr as unknown[])[1]) as Action,
  }));

  return user;
}

// ---- Middleware ----

/**
 * Verifies the JWT, loads the user from the DB, and attaches to context.
 * Replaces the old `requireAdminAuth`.
 */
export async function requireAuth(c: Context, next: Next) {
  const auth = c.req.header("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return unauthorized();

  const token = auth.slice("Bearer ".length).trim();
  if (!token) return unauthorized();

  const payload: JWTPayload | null = await verifyJWT(token);
  if (!payload) return unauthorized();

  const user = loadUserWithPermissions(payload.userId, payload.username);
  if (!user || !user.isActive) {
    return unauthorized("Account disabled or not found");
  }

  c.set("authUser", user);
  return await next();
}

/**
 * Legacy alias — kept so existing route registrations compile without changes
 * during the transition period. Functions identically to `requireAuth`.
 */
export const requireAdminAuth = requireAuth;

/**
 * Middleware factory: checks that the authenticated user has a specific permission.
 * Admins bypass all permission checks.
 *
 * Usage:
 *   app.get("/invoices", requireAuth, requirePermission("invoices", "read"), handler);
 */
export function requirePermission(resource: Resource, action: Action) {
  return async (c: Context, next: Next) => {
    const user = getAuthUser(c);
    if (!user) return unauthorized();

    // Admins have all permissions implicitly
    if (user.isAdmin) return await next();

    const has = user.permissions.some(
      (p) => p.resource === resource && p.action === action,
    );
    if (!has) {
      return forbidden(`Missing permission: ${resource}:${action}`);
    }

    return await next();
  };
}

/**
 * Middleware for routes on a single document (`/invoices/:id/...`): quotes
 * are checked against the "quotes" permissions, invoices and credit notes
 * against the "invoices" permissions.
 */
export function requireDocumentPermission(action: Action) {
  return async (c: Context, next: Next) => {
    const id = c.req.param("id");
    let resource: Resource = "invoices";
    if (id) {
      const rows = getDatabase().query(
        "SELECT document_type FROM invoices WHERE id = ?",
        [id],
      ) as unknown[][];
      if (rows[0]?.[0] === "quote") resource = "quotes";
    }
    return await requirePermission(resource, action)(c, next);
  };
}

/**
 * Middleware: requires the authenticated user to be an admin.
 */
export async function requireAdmin(c: Context, next: Next) {
  const user = getAuthUser(c);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden("Admin access required");
  return await next();
}
