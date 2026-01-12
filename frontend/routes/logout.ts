import { clearAuthCookieHeaders } from "../utils/backend.ts";
import { Handlers } from "fresh/compat";

export const handler: Handlers = {
  GET() {
    const headers = new Headers({ ...clearAuthCookieHeaders(), Location: "/" });
    return new Response(null, { status: 303, headers });
  },
  POST() {
    const headers = new Headers({ ...clearAuthCookieHeaders(), Location: "/" });
    return new Response(null, { status: 303, headers });
  },
};
