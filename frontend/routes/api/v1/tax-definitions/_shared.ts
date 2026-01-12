import {
  BACKEND_URL,
  getAuthHeaderFromCookie,
} from "../../../../utils/backend.ts";

export const TAX_SECTION_REDIRECT = "/settings?section=tax";

export function resolveAuth(req: Request): string | null {
  const fromHeader = req.headers.get("authorization") || undefined;
  if (fromHeader) return fromHeader;
  return getAuthHeaderFromCookie(req.headers.get("cookie") || undefined);
}

export function wantsJsonResponse(req: Request): boolean {
  if (req.method === "GET") return true;
  const accept = (req.headers.get("accept") || "").toLowerCase();
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  return accept.includes("application/json") ||
    contentType.includes("application/json");
}

export async function buildTaxDefinitionPayload(
  req: Request,
  { partial = false }: { partial?: boolean } = {},
): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") || "";
  let data: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    data = (await req.json().catch(() => {
      throw new Error("Invalid JSON body");
    })) as Record<string, unknown>;
  } else {
    const form = await req.formData();
    data = Object.fromEntries(form.entries()) as Record<string, unknown>;
  }

  return normalizePayload(data, { partial });
}

function normalizePayload(
  raw: Record<string, unknown>,
  { partial }: { partial: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  const code = stringOrNull(raw.code)?.trim();
  const name = stringOrNull(raw.name)?.trim();
  const percentRaw = stringOrNull(raw.percent) ??
    (typeof raw.percent === "number" ? String(raw.percent) : "");
  const countryCode = stringOrNull(raw.countryCode)?.trim();

  if (!partial || code) {
    if (!code) throw new Error("Tax code is required");
    payload.code = code;
  }
  if (!partial || name) {
    if (!name) throw new Error("Tax name is required");
    payload.name = name;
  }
  if (!partial || percentRaw) {
    const parsedPercent = Number(percentRaw);
    if (!Number.isFinite(parsedPercent)) {
      throw new Error("Tax percent must be a number");
    }
    payload.percent = parsedPercent;
  }
  if (countryCode) {
    payload.countryCode = countryCode.toUpperCase();
  }

  return payload;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

export async function proxyToBackend(
  req: Request,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const resp = await fetch(`${BACKEND_URL}${path}`, init);

  if (wantsJsonResponse(req)) {
    const body = await resp.text();
    const headers = new Headers(resp.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json; charset=utf-8");
    }
    return new Response(body, { status: resp.status, headers });
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => resp.statusText);
    return new Response(body || resp.statusText, {
      status: resp.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(null, {
    status: 303,
    headers: { Location: TAX_SECTION_REDIRECT },
  });
}
