import { PageProps } from "fresh";
import { getAuthHeaderFromCookie } from "../utils/backend.ts";
import { Handlers } from "fresh/compat";

export const handler: Handlers = {
  GET(ctx) {
    const req = ctx.req;
    const auth = getAuthHeaderFromCookie(
      req.headers.get("cookie") || undefined,
    );
    const Location = auth ? "/dashboard" : "/login";
    return new Response(null, { status: 303, headers: { Location } });
  },
};

export default function RedirectPage(_props: PageProps) {
  return null;
}
