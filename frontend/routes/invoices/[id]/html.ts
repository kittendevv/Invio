import {
  BACKEND_URL,
  getAuthHeaderFromCookie,
} from "../../../utils/backend.ts";
import { Handlers } from "fresh/compat";

export const handler: Handlers = {
  async GET(ctx) {
    const req = ctx.req;
    const auth = getAuthHeaderFromCookie(
      req.headers.get("cookie") || undefined,
    );
    if (!auth) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/login" },
      });
    }

    const { id } = ctx.params as { id: string };
    const backendUrl = `${BACKEND_URL}/api/v1/invoices/${id}/html`;

    const res = await fetch(backendUrl, { headers: { Authorization: auth } });
    if (!res.ok) {
      return new Response(`Upstream error: ${res.status} ${res.statusText}`, {
        status: res.status,
      });
    }

    const headers = new Headers();
    const ct = res.headers.get("content-type");
    const cc = res.headers.get("cache-control");
    if (ct) headers.set("content-type", ct);
    headers.set("cache-control", cc ?? "no-store");
    return new Response(res.body, { status: 200, headers });
  },
};
