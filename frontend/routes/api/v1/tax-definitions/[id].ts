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

    const id = String(ctx.params.id || "");
    return await proxyToBackend(
      req,
      `/api/v1/tax-definitions/${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers: { Authorization: auth },
      },
    );
  },

  async POST(ctx) {
    const req = ctx.req;
    const auth = resolveAuth(req);
    if (!auth) {
      return new Response("Unauthorized", { status: 401 });
    }

    const id = String(ctx.params.id || "");
    const form = await req.formData();
    const override = String(form.get("_method") || "").toUpperCase();

    // Re-create a Request-like body for shared payload builder: easiest is to
    // just normalize from form entries directly.
    const raw = Object.fromEntries(form.entries());
    delete (raw as Record<string, unknown>)["_method"];

    try {
      if (override === "DELETE") {
        return await proxyToBackend(
          req,
          `/api/v1/tax-definitions/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            headers: { Authorization: auth },
          },
        );
      }

      // Default: PUT (edit)
      const payload = await buildTaxDefinitionPayload(
        new Request(req.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(raw),
        }),
        { partial: false },
      );

      return await proxyToBackend(
        req,
        `/api/v1/tax-definitions/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  },

  async PUT(ctx) {
    const req = ctx.req;
    const auth = resolveAuth(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const id = String(ctx.params.id || "");
    try {
      const payload = await buildTaxDefinitionPayload(req);
      return await proxyToBackend(
        req,
        `/api/v1/tax-definitions/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  },

  async DELETE(ctx) {
    const req = ctx.req;
    const auth = resolveAuth(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const id = String(ctx.params.id || "");
    return await proxyToBackend(
      req,
      `/api/v1/tax-definitions/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { Authorization: auth },
      },
    );
  },
};
