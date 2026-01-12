import { BACKEND_URL } from "../../../../utils/backend.ts";
import { Handlers } from "fresh/compat";

export const handler: Handlers = {
  async GET(ctx) {
    const { share_token } = ctx.params as { share_token: string };
    const backendUrl =
      `${BACKEND_URL}/api/v1/public/invoices/${share_token}/html`;
    const res = await fetch(backendUrl);
    if (!res.ok) {
      return new Response(`Upstream error: ${res.status} ${res.statusText}`, {
        status: res.status,
      });
    }
    const html = await res.text();
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex",
      },
    });
  },
};
