import {
  buildTaxDefinitionPayload,
  proxyToBackend,
  resolveAuth,
} from "./_shared.ts";
import { Handlers } from "fresh/compat";

export const handler: Handlers = {
  async GET(ctx) {
    const req = ctx.req;
    const auth = resolveAuth(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    return await proxyToBackend(req, "/api/v1/tax-definitions", {
      method: "GET",
      headers: { Authorization: auth },
    });
  },

  async POST(ctx) {
    const req = ctx.req;
    const auth = resolveAuth(req);
    if (!auth) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const payload = await buildTaxDefinitionPayload(req);
      return await proxyToBackend(req, "/api/v1/tax-definitions", {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
