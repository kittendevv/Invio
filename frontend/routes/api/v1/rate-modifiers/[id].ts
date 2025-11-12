import { Handlers } from "$fresh/server.ts";
import { BACKEND_URL, getAuthHeaderFromCookie } from "../../../../utils/backend.ts";

// Proxy individual rate-modifier API to backend (GET/PUT/DELETE by ID)
async function proxyToBackend(req: Request, ctx: any) {
  const auth = getAuthHeaderFromCookie(req.headers.get("cookie") || undefined);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401, 
      headers: { "content-type": "application/json" } 
    });
  }

  const { id } = ctx.params;
  const backendUrl = `${BACKEND_URL}/api/v1/rate-modifiers/${id}`;
  
  const headers: HeadersInit = { Authorization: auth };
  
  // Forward content-type for PUT/PATCH
  const contentType = req.headers.get("content-type");
  if (contentType) {
    headers["content-type"] = contentType;
  }

  const options: RequestInit = {
    method: req.method,
    headers,
  };

  // Include body for PUT/PATCH
  if (["PUT", "PATCH"].includes(req.method)) {
    options.body = await req.text();
  }

  const resp = await fetch(backendUrl, options);

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return new Response(body || `Backend error ${resp.status}`, { 
      status: resp.status, 
      headers: { "content-type": "application/json" } 
    });
  }

  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "content-type": "application/json" },
  });
}

export const handler: Handlers = {
  GET: proxyToBackend,
  PUT: proxyToBackend,
  PATCH: proxyToBackend,
  DELETE: proxyToBackend,
};
