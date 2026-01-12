import { getAuthHeaderFromCookie } from "../../../utils/backend.ts";
import { Handlers } from "fresh/compat";

export const handler: Handlers = {
  async POST(ctx) {
    const req = ctx.req;

    try {
      const auth = getAuthHeaderFromCookie(
        req.headers.get("cookie") || undefined,
      );
      if (!auth) return new Response("Unauthorized", { status: 401 });
      const { url } = await req.json().catch(() => ({}));
      if (!url || typeof url !== "string") {
        return new Response(JSON.stringify({ error: "Missing 'url'" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Proxy the backend response including status codes to avoid masking errors as 500s
      const res = await fetch(
        `${
          Deno.env.get("BACKEND_URL") || "http://localhost:3000"
        }/api/v1/templates/install-from-manifest`,
        {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );
      const text = await res.text();
      const body = text && text.trim().startsWith("{")
        ? text
        : JSON.stringify({ ok: res.ok, status: res.status, body: text });
      return new Response(body, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
