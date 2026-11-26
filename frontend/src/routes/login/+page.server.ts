import { fail, redirect } from "@sveltejs/kit";
import type { PageServerLoad, Actions } from "./$types";
import {
  BACKEND_URL,
  SESSION_COOKIE,
  DEFAULT_SESSION_MAX_AGE,
} from "$lib/backend";
import { getDemoMode } from "$lib/demo";
import { env } from "$env/dynamic/private";
import { tKey } from "$lib/i18n/mod";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) {
    throw redirect(303, "/dashboard");
  }
  const oidcEnabled =
    (env.OIDC_ENABLED || "false").toLowerCase() === "true";
  const urlError = url.searchParams.get("error");
  return {
    oidcEnabled,
    oidcError: urlError?.startsWith("oidc_")
      ? "SSO login failed. Please try again or use username and password."
      : null,
  };
};
export const actions: Actions = {
  login: async ({ request, cookies, getClientAddress }) => {
    const form = await request.formData();

    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "").trim();
    const twoFactorToken = String(form.get("twoFactorToken") ?? "").trim();
    const totpToken = String(form.get("token") ?? "")
      .replace(/\s+/g, "")
      .trim();
    const recoveryCode = String(form.get("recoveryCode") ?? "").trim();

    // Backend login rate limits are keyed on this address.
    const clientAddress = getClientAddress();

    let resp: Response;
    let data: any = null;

    const isSecondStep = Boolean(twoFactorToken);
    if (!isSecondStep) {
      if (!username || !password) {
        return fail(400, {
          error: tKey("Missing credentials"),
          username,
        });
      }

      try {
        resp = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": clientAddress,
          },
          body: JSON.stringify({ username, password }),
        });
      } catch {
        return fail(500, {
          error: tKey("Unable to reach authentication server"),
          username,
        });
      }

      try {
        data = await resp.json();
      } catch {
        return fail(500, {
          error: tKey("Invalid server response"),
          username,
        });
      }

      if (!resp.ok) {
        if (resp.status === 401) {
          return fail(401, { error: tKey("Invalid credentials"), username });
        }

        if (resp.status === 429) {
          const retryAfter = data?.retryAfter;
          const minutes = retryAfter ? Math.ceil(retryAfter / 60) : 15;

          return fail(429, {
            error:
              tKey("Too many login attempts. Try again in {{minutes}} minute(s)."),
            errorParams: { minutes },
            username,
          });
        }

        return fail(resp.status, {
          error: data?.error ?? tKey("Login failed"),
          username,
        });
      }

      if (data?.twoFactorRequired && data?.twoFactorToken) {
        return {
          twoFactorRequired: true,
          twoFactorToken: data.twoFactorToken,
          username,
        };
      }
    } else {
      const useRecovery = Boolean(recoveryCode);
      if (!totpToken && !useRecovery) {
        return fail(400, {
          error: tKey("Enter your 2FA code or recovery code"),
          twoFactorRequired: true,
          twoFactorToken,
          username,
        });
      }
      const endpoint = useRecovery ? "recover-2fa" : "verify-2fa";
      const payload = useRecovery
        ? { twoFactorToken, recoveryCode }
        : { twoFactorToken, token: totpToken };
      try {
        resp = await fetch(`${BACKEND_URL}/api/v1/auth/${endpoint}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": clientAddress,
          },
          body: JSON.stringify(payload),
        });
      } catch {
        return fail(500, {
          error: tKey("Unable to reach authentication server"),
          twoFactorRequired: true,
          twoFactorToken,
          username,
        });
      }
      try {
        data = await resp.json();
      } catch {
        return fail(500, {
          error: tKey("Invalid server response"),
          twoFactorRequired: true,
          twoFactorToken,
          username,
        });
      }
      if (!resp.ok) {
        return fail(resp.status, {
          error: data?.error ?? tKey("2FA verification failed"),
          twoFactorRequired: true,
          twoFactorToken,
          username,
        });
      }
    }

    if (!data?.token) {
      return fail(500, {
        error: tKey("Login response missing token"),
        username,
      });
    }

    cookies.set(SESSION_COOKIE, data.token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: data.expiresIn ?? DEFAULT_SESSION_MAX_AGE,
    });

    throw redirect(303, "/dashboard");
  },

  oidcLogin: async () => {
    let resp: Response;
    try {
      resp = await fetch(`${BACKEND_URL}/api/v1/auth/oidc/authorize`);
    } catch {
      return fail(500, { error: tKey("Unable to reach authentication server") });
    }
    if (!resp.ok) {
      return fail(503, { error: tKey("SSO login is not available") });
    }
    const data = await resp.json();
    if (!data?.url) {
      return fail(500, { error: tKey("Invalid SSO response") });
    }
    throw redirect(303, data.url);
  },
};
