import { redirect, fail } from "@sveltejs/kit";
import { backendGet, backendPost } from "$lib/backend";
import type { PageServerLoad, Actions } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  const hasPerm =
    locals.user.isAdmin ||
    locals.user.permissions?.some(
      (p: any) => p.resource === "products" && p.action === "create",
    );
  if (!hasPerm) {
    throw redirect(303, "/products");
  }

  try {
    const [taxDefinitions, categories, units] = await Promise.all([
      backendGet("/api/v1/tax-definitions", locals.authHeader),
      backendGet("/api/v1/product-categories", locals.authHeader),
      backendGet("/api/v1/product-units", locals.authHeader),
    ]);

    return {
      taxDefinitions: taxDefinitions || [],
      categories: categories || [],
      units: units || [],
    };
  } catch (err: any) {
    return {
      error: err.message,
      taxDefinitions: [],
      categories: [],
      units: [],
    };
  }
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(303, "/login");
    }

    const form = await request.formData();
    const name = String(form.get("name") || "");
    const description = String(form.get("description") || "");
    const unitPrice = parseFloat(String(form.get("unitPrice") || "0"));
    const sku = String(form.get("sku") || "");
    const unit = String(form.get("unit") || "");
    const category = String(form.get("category") || "");
    const taxDefinitionId = String(form.get("taxDefinitionId") || "");
    const hsCode = String(form.get("hsCode") || "");
    const countryOfOrigin = String(form.get("countryOfOrigin") || "");
    const num = (key: string) => {
      const v = parseFloat(String(form.get(key) ?? ""));
      return Number.isFinite(v) ? v : null;
    };

    if (!name) {
      return fail(400, { error: "Name is required" });
    }

    let created: any;
    try {
      created = await backendPost("/api/v1/products", locals.authHeader, {
        name,
        description: description || undefined,
        unitPrice,
        sku: sku || undefined,
        unit: unit || undefined,
        category: category || undefined,
        taxDefinitionId: taxDefinitionId || undefined,
        hsCode,
        countryOfOrigin,
        lengthMm: num("lengthMm"),
        widthMm: num("widthMm"),
        heightMm: num("heightMm"),
        weightG: num("weightG"),
      });
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e && "location" in e)
        throw e;
      return fail(500, { error: e.message || String(e) });
    }

    if (created && created.id) {
      throw redirect(303, `/products/${created.id}`);
    }
    return fail(500, { error: "Failed to read created product ID" });
  },
};
