import { getAuthHeaderFromCookie } from "$lib/auth";
import { BACKEND_URL } from "$lib/backend";
import { buildBackendHeaders } from "$lib/forwardHeaders";
import type { RequestHandler } from "@sveltejs/kit";

export const fallback: RequestHandler = async ({ request, url, cookies, getClientAddress }) => {
  const backendUrl = new URL(url.pathname + url.search, BACKEND_URL);

  const headers = buildBackendHeaders(request.headers, getClientAddress());

  if (!headers.has("authorization")) {
    const token = cookies.get("invio_session");
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  // required by bun/node when streaming Request bodies
  (init as any).duplex = "half";

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const resp = await fetch(backendUrl.toString(), init);
  const respHeaders = new Headers();

  // Read the entire body to avoid proxy stream corruption
  const buffer = await resp.arrayBuffer();

  // Copy headers from response except those that relate to the original connection's encoding/chunking
  for (const [k, v] of resp.headers.entries()) {
    const lowerK = k.toLowerCase();
    if (lowerK === "content-encoding") continue;
    if (lowerK === "content-length") continue;
    if (lowerK === "transfer-encoding") continue;
    if (lowerK === "connection") continue;
    respHeaders.set(k, v);
  }

  if (!respHeaders.has("content-type")) {
    respHeaders.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(buffer, {
    status: resp.status,
    headers: respHeaders,
  });
};
