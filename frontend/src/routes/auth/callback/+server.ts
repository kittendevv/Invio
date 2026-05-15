import type { RequestHandler } from "./$types";
import { redirect } from "@sveltejs/kit";
import { BACKEND_URL, SESSION_COOKIE, DEFAULT_SESSION_MAX_AGE } from "$lib/backend";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const error = url.searchParams.get("error");
  if (error) {
    throw redirect(303, `/login?error=oidc_${encodeURIComponent(error)}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    throw redirect(303, "/login?error=oidc_missing_params");
  }

  let resp: Response;
  try {
    resp = await fetch(`${BACKEND_URL}/api/v1/auth/oidc/callback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
  } catch {
    throw redirect(303, "/login?error=oidc_server_error");
  }

  if (!resp.ok) {
    throw redirect(303, "/login?error=oidc_failed");
  }

  const data = await resp.json();
  if (!data?.token) {
    throw redirect(303, "/login?error=oidc_failed");
  }

  cookies.set(SESSION_COOKIE, data.token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: data.expiresIn ?? DEFAULT_SESSION_MAX_AGE,
  });

  throw redirect(303, "/dashboard");
};
