import { dev } from "$app/environment";
import { error, type Handle } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { resolveLocalization, DEFAULT_LOCALIZATION } from "$lib/i18n/mod";
import { getAuthHeaderFromCookie } from "$lib/auth";
import { backendGet } from "$lib/backend";
import {
  isMutatingFormRequest,
  originAllowed,
  originMatchesRequestHost,
  parseAllowedOrigins,
} from "$lib/csrf";

function assertTrustedFormOrigin(event: Parameters<Handle>[0]["event"]): void {
  if (!isMutatingFormRequest(event.request)) {
    return;
  }

  const origin = event.request.headers.get("origin") ?? "";
  const allowedOrigins = parseAllowedOrigins(env.ORIGIN, env.TRUSTED_ORIGINS);

  const allowed =
    allowedOrigins.length > 0
      ? originAllowed(origin, allowedOrigins)
      : originMatchesRequestHost(origin, event.request.headers.get("host"));

  if (!allowed) {
    error(
      403,
      `Cross-site ${event.request.method} form submissions are forbidden`,
    );
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  if (!dev) {
    assertTrustedFormOrigin(event);
  }

  const cookieString = event.request.headers.get("cookie");

  // Auth
  const authHeader = cookieString
    ? getAuthHeaderFromCookie(cookieString)
    : null;
  event.locals.authHeader = authHeader || "";
  event.locals.user = null;
  event.locals.localization = DEFAULT_LOCALIZATION;
  if (authHeader) {
    try {
      // Fetch both in parallel just like in deno
      const [settingsResult, userResult] = await Promise.allSettled([
        backendGet("/api/v1/settings", authHeader),
        backendGet("/api/v1/users/me", authHeader),
      ]);

      if (settingsResult.status === "fulfilled") {
        const settings = settingsResult.value;
        event.locals.localization = resolveLocalization(
          settings.locale,
          settings.numberFormat,
          settings.dateFormat,
          settings.postalCityFormat,
        );
      }

      if (userResult.status === "fulfilled") {
        event.locals.user = userResult.value;
      }
    } catch {
      // ignore
    }
  }

  // Response & CSP
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => {
      return html
        .replace("%lang%", event.locals.localization.locale.split("-")[0])
        .replace("%numberFormat%", event.locals.localization.numberFormat)
        .replace("%dateFormat%", event.locals.localization.dateFormat);
    },
  });

  response.headers.set(
    "Content-Security-Policy",
    `default-src 'none'; ` +
      `script-src 'self' 'unsafe-inline'; ` +
      `style-src 'self' 'unsafe-inline'; ` +
      `img-src 'self' data: blob:; ` +
      `font-src 'self' https://fonts.gstatic.com; ` +
      `connect-src 'self'; ` +
      `frame-src 'self'; ` +
      `manifest-src 'self';`,
  );

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
};
