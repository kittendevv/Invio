import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { backendGet, SESSION_COOKIE } from "$lib/backend";

export const load: PageServerLoad = async ({ locals, cookies }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  const token = cookies.get(SESSION_COOKIE);
  const auth = token ? `Bearer ${token}` : "";

  try {
    const quotes = (await backendGet("/api/v1/quotes", auth)) as any[];
    quotes.sort((a, b) =>
      String(b?.invoiceNumber || "").localeCompare(String(a?.invoiceNumber || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
    return { quotes };
  } catch (err) {
    return { error: String(err), quotes: [] };
  }
};
