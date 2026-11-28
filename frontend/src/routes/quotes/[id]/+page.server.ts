import { backendDelete, backendGet, backendPost } from "$lib/backend";
import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { env } from "$env/dynamic/private";

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.authHeader) {
    throw redirect(303, "/login");
  }
  let quote;
  try {
    quote = await backendGet(`/api/v1/invoices/${params.id}`, locals.authHeader);
  } catch {
    throw error(404, "Quote not found");
  }
  // An invoice opened under /quotes belongs to the invoice pages
  if (quote?.documentType !== "quote") {
    throw redirect(303, `/invoices/${params.id}`);
  }
  return {
    quote,
    showPublishedBanner: url.searchParams.get("published") === "1",
    emailEnabled: Boolean(env.SMTP_HOST && env.EMAIL_FROM_ADDRESS),
  };
};

const isRedirect = (e: unknown) => Boolean(e && typeof e === "object" && "status" in e && "location" in e);

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    if (!locals.authHeader) throw redirect(303, "/login");
    const data = await request.formData();
    const intent = String(data.get("intent") || "");
    const id = params.id;

    try {
      if (intent === "publish") {
        await backendPost(`/api/v1/invoices/${id}/publish`, locals.authHeader, {});
        throw redirect(303, `/quotes/${id}?published=1`);
      }
      if (intent === "accept" || intent === "decline") {
        await backendPost(`/api/v1/quotes/${id}/${intent}`, locals.authHeader, {});
        throw redirect(303, `/quotes/${id}`);
      }
      if (intent === "invoice") {
        const invoice = await backendPost(`/api/v1/quotes/${id}/invoice`, locals.authHeader, {});
        if (!invoice?.id) throw new Error("Failed to create invoice");
        throw redirect(303, `/invoices/${invoice.id}/edit`);
      }
      if (intent === "duplicate") {
        const copy = await backendPost(`/api/v1/invoices/${id}/duplicate`, locals.authHeader, {});
        if (!copy?.id) throw new Error("Failed to duplicate quote");
        throw redirect(303, `/quotes/${copy.id}/edit`);
      }
      if (intent === "delete") {
        await backendDelete(`/api/v1/invoices/${id}`, locals.authHeader);
        throw redirect(303, "/quotes");
      }
      if (intent === "send-email") {
        const to = String(data.get("emailTo") ?? "")
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.includes("@"));
        const subject = String(data.get("emailSubject") ?? "").trim();
        const message = String(data.get("emailMessage") ?? "").trim();
        if (to.length === 0) return fail(400, { emailError: "Enter at least one valid recipient email address." });
        if (!subject) return fail(400, { emailError: "Subject is required." });
        try {
          await backendPost(`/api/v1/invoices/${id}/send-email`, locals.authHeader, { to, subject, message });
          return { emailSent: true, emailRecipients: to };
        } catch (e) {
          return fail(502, { emailError: `Failed to send: ${String(e)}` });
        }
      }
    } catch (e) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: String(e) });
    }
  },
};
