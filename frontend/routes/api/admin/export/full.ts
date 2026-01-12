import {
  BACKEND_URL,
  getAuthHeaderFromCookie,
} from "../../../../utils/backend.ts";
import { Handlers } from "fresh/compat";

// Proxy export download to the backend while allowing a re-auth prompt.
export const handler: Handlers = {
  async GET(ctx) {
    const req = ctx.req;
    const url = new URL(req.url);
    const includeDb = url.searchParams.get("includeDb") ?? "true";
    const includeJson = url.searchParams.get("includeJson") ?? "true";
    const includeAssets = url.searchParams.get("includeAssets") ?? "true";

    // Prefer Authorization header from the client, else cookie
    const authFromHeader = req.headers.get("authorization") || undefined;
    const authFromCookie =
      getAuthHeaderFromCookie(req.headers.get("cookie") || undefined) ||
      undefined;
    const auth = authFromHeader || authFromCookie;
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const backendUrl =
      `${BACKEND_URL}/api/v1/export/full?includeDb=${includeDb}&includeJson=${includeJson}&includeAssets=${includeAssets}`;
    const resp = await fetch(backendUrl, { headers: { Authorization: auth } });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return new Response(body || `Backend error ${resp.status}`, {
        status: resp.status,
        headers: {
          "content-type": resp.headers.get("content-type") || "text/plain",
        },
      });
    }
    // Stream through headers and body
    const headers = new Headers();
    const contentType = resp.headers.get("content-type") || "application/gzip";
    const cd = resp.headers.get("content-disposition") ||
      'attachment; filename="invio-export.tar.gz"';
    headers.set("content-type", contentType);
    headers.set("content-disposition", cd);
    headers.set("cache-control", "no-store");
    return new Response(resp.body, { status: 200, headers });
  },
};
