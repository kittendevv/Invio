import { getAuthHeaderFromCookie } from "../../utils/backend.ts";
import { Handlers } from "fresh/compat";

export const handler: Handlers = {
  GET(ctx) {
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
    return new Response(null, {
      status: 303,
      headers: { Location: "/settings" },
    });
  },
  POST(ctx) {
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
    return new Response(null, {
      status: 303,
      headers: { Location: "/settings" },
    });
  },
};

export default function Redirect() {
  return null;
}
