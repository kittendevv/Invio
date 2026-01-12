import { BACKEND_URL } from "../../../../utils/backend.ts";
import { Handlers } from "fresh/compat";

export const handler: Handlers = {
  async GET(ctx) {
    const { share_token } = ctx.params as { share_token: string };
    const backendUrl =
      `${BACKEND_URL}/api/v1/public/invoices/${share_token}/ubl.xml`;
    const res = await fetch(backendUrl);
    if (!res.ok) {
      return new Response(`Upstream error: ${res.status} ${res.statusText}`, {
        status: res.status,
      });
    }
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex");
    return new Response(res.body, { status: 200, headers });
  },
};
