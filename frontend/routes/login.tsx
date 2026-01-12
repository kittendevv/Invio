import { PageProps } from "fresh";
import { Layout } from "../components/Layout.tsx";
import { BACKEND_URL, setAuthCookieHeaders } from "../utils/backend.ts";
import { renderPage } from "../utils/render.tsx";
import { useTranslations } from "../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type Data = {
  error: string | null;
  errorParams?: Record<string, string | number>;
  username?: string;
  demoMode?: boolean;
};

export const handler: Handlers<Data> = {
  async GET(ctx) {
    // Try to fetch public settings to detect demoMode
    try {
      const resp = await fetch(`${BACKEND_URL}/api/v1/demo-mode`);
      if (resp.ok) {
        const body = await resp.json();
        const demoMode = body?.demoMode === true || body?.demoMode === "true";
        return renderPage(ctx, LoginPage, { error: null, demoMode });
      }
    } catch (_e) {
      // ignore
    }
    return renderPage(ctx, LoginPage, { error: null });
  },
  async POST(ctx) {
    const req = ctx.req;
    const form = await req.formData();
    const username = String(form.get("username") || "");
    const password = String(form.get("password") || "");
    if (!username || !password) {
      return renderPage(ctx, LoginPage, { error: "Missing credentials", username });
    }
    // Attempt to obtain a short-lived JWT session token from the backend
    try {
      const resp = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!resp.ok) {
        let parsedError: unknown = null;
        try {
          parsedError = await resp.json();
        } catch {
          try {
            const text = await resp.text();
            parsedError = text ? { error: text } : null;
          } catch {
            parsedError = null;
          }
        }
        if (resp.status === 401) {
          return renderPage(ctx, LoginPage, { error: "Invalid credentials", username });
        }
        if (resp.status === 429) {
          // Rate limited - extract retry time if available
          const retryAfter = (parsedError as { retryAfter?: number })
            ?.retryAfter;
          const minutes = retryAfter ? Math.ceil(retryAfter / 60) : 15;
          return renderPage(ctx, LoginPage, {
            error:
              "Too many login attempts. Please try again in {{minutes}} minute(s).",
            errorParams: { minutes },
            username,
          });
        }
        let message: string | null = null;
        if (parsedError && typeof parsedError === "object") {
          const candidate =
            (parsedError as { error?: unknown; message?: unknown }).error ??
              (parsedError as { error?: unknown; message?: unknown }).message;
          if (typeof candidate === "string" && candidate.trim().length > 0) {
            message = candidate.trim();
          }
        } else if (
          typeof parsedError === "string" && parsedError.trim().length > 0
        ) {
          message = parsedError.trim();
        }
        const msg = message ?? `${resp.status} ${resp.statusText}`;
        return renderPage(ctx, LoginPage, { error: msg, username });
      }
      const data = await resp.json() as { token?: string; expiresIn?: number };
      if (!data?.token) {
        return renderPage(ctx, LoginPage, {
          error: "Login response missing token",
          username,
        });
      }
      const headers = new Headers({
        ...setAuthCookieHeaders(data.token, data.expiresIn),
        Location: "/dashboard",
      });
      return new Response(null, { status: 303, headers });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (/401|403/.test(errorMessage)) {
        return renderPage(ctx, LoginPage, { error: "Invalid credentials", username });
      }
      if (/5\d\d/.test(errorMessage)) {
        return renderPage(ctx, LoginPage, {
          error: "Server error. Please try again later.",
          username,
        });
      }
      return renderPage(ctx, LoginPage, {
        error:
          "Unable to connect to server. Please check your connection and try again.",
        username,
      });
    }
  },
};

export default function LoginPage(props: PageProps<Data>) {
  const { t } = useTranslations();
  const username = props.data.username || "";
  const dm =
    (props.data as unknown as { demoMode?: boolean | string }).demoMode;
  const demoMode = dm === true || dm === "true";
  return (
    <Layout path={new URL(props.url).pathname} demoMode={demoMode}>
      <div class="min-h-[65vh] flex items-center justify-center">
        <div class="w-full max-w-sm">
          <div class="card bg-base-100 shadow-xl">
            <div class="card-body">
              <h1 class="text-2xl font-semibold text-center mb-2">
                {t("Sign in")}
              </h1>

              {demoMode && (
                <div class="alert alert-info mb-4">
                  <div class="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span class="font-semibold">{t("Demo credentials:")}</span>
                    <div class="flex gap-3 flex-wrap">
                      <span>
                        {t("username")}: <code>demo</code>
                      </span>
                      <span>
                        {t("password")}: <code>demo</code>
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {props.data.error && (
                <div class="alert alert-error mb-3">
                  <span>{t(props.data.error, props.data.errorParams)}</span>
                </div>
              )}

              <form method="post" class="space-y-3">
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">{t("Username")}</span>
                  </label>
                  <input
                    class="input input-bordered w-full"
                    name="username"
                    value={username}
                    placeholder={t("Username")}
                    autocomplete="username"
                    autoFocus
                    required
                  />
                </div>
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">{t("Password")}</span>
                  </label>
                  <input
                    class="input input-bordered w-full"
                    name="password"
                    type="password"
                    placeholder={t("Password")}
                    autocomplete="current-password"
                    required
                  />
                </div>
                <button type="submit" class="btn btn-primary w-full">
                  {t("Login")}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
