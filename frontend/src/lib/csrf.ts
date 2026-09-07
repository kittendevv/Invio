const FORM_CONTENT_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isFormContentType(request: Request): boolean {
  const type =
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() ?? "";
  return FORM_CONTENT_TYPES.has(type);
}

export function isMutatingFormRequest(request: Request): boolean {
  return MUTATING_METHODS.has(request.method) && isFormContentType(request);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function originAllowed(origin: string, patterns: string[]): boolean {
  if (!origin) return false;
  for (const pattern of patterns) {
    if (pattern === "*") return true;
    if (pattern === origin) return true;
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.split("*").map(escapeRegex).join(".+") + "$",
      );
      if (regex.test(origin)) return true;
    }
  }
  return false;
}

export function parseAllowedOrigins(
  originEnv: string | undefined,
  trustedOriginsEnv: string | undefined,
): string[] {
  return [
    ...(originEnv?.trim() ? [originEnv.trim()] : []),
    ...(trustedOriginsEnv ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
}

/** True when Origin's host[:port] matches the incoming Host header (scheme ignored). */
export function originMatchesRequestHost(
  origin: string,
  hostHeader: string | null | undefined,
): boolean {
  if (!origin || !hostHeader) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === hostHeader || originUrl.hostname === hostHeader;
  } catch {
    return false;
  }
}
