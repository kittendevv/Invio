export const BACKEND_URL = Deno.env.get("BACKEND_URL") ||
  "http://localhost:3000";

const SESSION_COOKIE = "invio_session";
const DEFAULT_SESSION_MAX_AGE = Math.max(
  300,
  Math.min(
    60 * 60 * 12,
    parseInt(Deno.env.get("SESSION_TTL_SECONDS") || "3600", 10) || 3600,
  ),
);
const COOKIE_SECURE =
  (Deno.env.get("COOKIE_SECURE") || "true").toLowerCase() !== "false";

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(/;\s*/).map((p) => {
      const i = p.indexOf("=");
      if (i === -1) return [p, ""];
      return [
        decodeURIComponent(p.slice(0, i)),
        decodeURIComponent(p.slice(i + 1)),
      ];
    }),
  );
}

export function getAuthHeaderFromCookie(cookieHeader?: string): string | null {
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return `Bearer ${token}`;
}

export function setAuthCookieHeaders(
  token: string,
  maxAgeSeconds = DEFAULT_SESSION_MAX_AGE,
): HeadersInit {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
    attrs.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  }
  return { "Set-Cookie": attrs.join("; ") };
}

export function clearAuthCookieHeaders(): HeadersInit {
  const attrs = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return { "Set-Cookie": attrs.join("; ") };
}

export async function backendGet(path: string, authHeader: string) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

export async function backendPost(
  path: string,
  authHeader: string,
  body: unknown,
) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

export async function backendPut(
  path: string,
  authHeader: string,
  body: unknown,
) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

export async function backendPatch(
  path: string,
  authHeader: string,
  body: unknown,
) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

export async function backendDelete(path: string, authHeader: string) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "DELETE",
    headers: { Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  // Some DELETEs may return 204 No Content
  const contentType = res.headers.get("content-type") || "";
  if (res.status === 204 || !contentType.includes("application/json")) {
    return undefined;
  }
  return await res.json();
}
