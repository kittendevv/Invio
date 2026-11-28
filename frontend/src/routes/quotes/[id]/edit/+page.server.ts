import { backendGet } from "$lib/backend";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.authHeader) {
    throw redirect(303, "/login");
  }

  const [quoteRes, customersRes, productsRes, taxDefinitionsRes, settingsRes] = await Promise.allSettled([
    backendGet(`/api/v1/invoices/${params.id}`, locals.authHeader),
    backendGet("/api/v1/customers", locals.authHeader),
    backendGet("/api/v1/products", locals.authHeader),
    backendGet("/api/v1/tax-definitions", locals.authHeader),
    backendGet("/api/v1/settings", locals.authHeader),
  ]);
  if (quoteRes.status !== "fulfilled") {
    throw error(404, "Quote not found");
  }
  const quote = quoteRes.value;
  // An invoice opened under /quotes belongs to the invoice pages
  if (quote?.documentType !== "quote") {
    throw redirect(303, `/invoices/${params.id}/edit`);
  }

  return {
    invoice: quote,
    customers: customersRes.status === "fulfilled" ? customersRes.value : [],
    products: productsRes.status === "fulfilled" ? productsRes.value : [],
    taxDefinitions: taxDefinitionsRes.status === "fulfilled" ? taxDefinitionsRes.value : [],
    settings: settingsRes.status === "fulfilled" ? settingsRes.value : {},
  };
};
