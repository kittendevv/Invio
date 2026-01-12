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
    const url = new URL(req.url);
    const profile = url.searchParams.get("profile");
    const backendUrl = `${BACKEND_URL}/api/v1/invoices/${id}/xml${
      profile ? `?profile=${encodeURIComponent(profile)}` : ""
    }`;
    const res = await fetch(backendUrl, { headers: { Authorization: auth } });
    if (!res.ok) {
      return new Response(`Upstream error: ${res.status} ${res.statusText}`, {
        status: res.status,
      });
    }
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(res.body, { status: 200, headers });
  },
};
