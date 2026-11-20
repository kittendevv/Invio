import { backendGet } from "$lib/backend";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.authHeader) {
    throw redirect(303, "/login");
  }

  try {
    const [
      invoiceRes,
      customersRes,
      productsRes,
      taxDefinitionsRes,
      settingsRes,
    ] = await Promise.allSettled([
      backendGet(`/api/v1/invoices/${params.id}`, locals.authHeader),
      backendGet("/api/v1/customers", locals.authHeader),
      backendGet("/api/v1/products", locals.authHeader),
      backendGet("/api/v1/tax-definitions", locals.authHeader),
      backendGet("/api/v1/settings", locals.authHeader),
    ]);

    if (invoiceRes.status !== "fulfilled") {
      throw error(404, "Invoice not found");
    }
    // Quotes have their own pages
    if ((invoiceRes.value as { documentType?: string })?.documentType === "quote") {
      throw redirect(303, `/quotes/${params.id}/edit`);
    }

    const settings =
      settingsRes.status === "fulfilled"
        ? (settingsRes.value as Record<string, unknown>)
        : {};

    return {
      invoice: invoiceRes.value,
      customers: customersRes.status === "fulfilled" ? customersRes.value : [],
      products: productsRes.status === "fulfilled" ? productsRes.value : [],
      taxDefinitions:
        taxDefinitionsRes.status === "fulfilled" ? taxDefinitionsRes.value : [],
      allowProtectedInvoiceChanges:
        String(
          settings.allowProtectedInvoiceChanges || "false",
        ).toLowerCase() === "true",
    };
  } catch (err: any) {
    if (err && typeof err === "object" && "location" in err) throw err;
    throw error(404, err?.message || "Invoice not found");
  }
};
