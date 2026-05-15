// @ts-nocheck: route handlers use Hono context without typings to keep edits minimal
import { Hono } from "hono";
import {
  createInvoice,
  deleteInvoice,
  duplicateInvoice,
  getInvoiceById,
  getInvoices,
  getLatestPaidPaymentMethods,
  publishInvoice,
  unpublishInvoice,
  updateInvoice,
  voidInvoice,
} from "../controllers/invoices.ts";
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  getTemplates,
  installLocalTemplateFromZip,
  installTemplateFromManifest,
  loadTemplateFromFile,
  renderTemplate,
  setDefaultTemplate,
} from "../controllers/templates.ts";
import {
  deleteSetting,
  getSetting,
  getSettings,
  setSetting,
  updateSettings,
} from "../controllers/settings.ts";
import {
  createCustomer,
  deleteCustomer,
  getCustomerById,
  getCustomers,
  updateCustomer,
} from "../controllers/customers.ts";
import {
  createProduct,
  deleteProduct,
  getProductById,
  getProducts,
  isProductUsedInInvoices,
  reactivateProduct,
  updateProduct,
} from "../controllers/products.ts";
import {
  createTaxDefinition,
  deleteTaxDefinition,
  getTaxDefinitionById,
  getTaxDefinitions,
  updateTaxDefinition,
} from "../controllers/taxDefinitions.ts";
import {
  createCategory,
  createUnit,
  deleteCategory,
  deleteUnit,
  getCategories,
  getUnits,
  isCategoryUsed,
  isUnitUsed,
  updateCategory,
  updateUnit,
} from "../controllers/productOptions.ts";
import { buildInvoiceHTML, generatePDF } from "../utils/pdf.ts";
import { isEmailConfigured, sendEmail } from "../utils/email.ts";
import { generateUBLInvoiceXML } from "../utils/ubl.ts"; // legacy direct import
import { generateInvoiceXML, listXMLProfiles } from "../utils/xmlProfiles.ts";
import { availableInvoiceLocales } from "../i18n/translations.ts";

import { resetDatabaseFromDemo } from "../database/init.ts";
import { getNextInvoiceNumber } from "../database/init.ts";
import { isDemoMode } from "../utils/env.ts";
import {
  normalizeStoredLogoReference,
  saveDataUrlLogo,
  saveUploadedLogoFile,
} from "../utils/logoStorage.ts";
import {
  getAuthUser,
  requireAdminAuth,
  requirePermission,
} from "../middleware/auth.ts";
import {
  createUser as createUserCtrl,
  deleteUser as deleteUserCtrl,
  disableUserTwoFactor,
  getUserById as getUserByIdCtrl,
  getUserTwoFactorState,
  listUsers,
  setUserTwoFactorState,
  updateUser as updateUserCtrl,
} from "../controllers/users.ts";
import { RESOURCE_ACTIONS, RESOURCES } from "../types/index.ts";
import {
  createPendingTwoFactorSetup,
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyPendingTwoFactorSetup,
  verifyTotpToken,
} from "../utils/twoFactor.ts";

const adminRoutes = new Hono();

// Normalize tax-related settings coming from the client to robust canonical forms
function normalizeTaxSettingsPayload(data: Record<string, unknown>) {
  // defaultTaxRate: parse to finite non-negative number, store as canonical string
  if (data && Object.prototype.hasOwnProperty.call(data, "defaultTaxRate")) {
    const raw = String(
      (data as Record<string, unknown>)["defaultTaxRate"] ?? "",
    ).trim();
    const norm = raw.replace(",", ".");
    const n = Number(norm);
    if (!isFinite(n) || isNaN(n) || n < 0) {
      // Remove invalid value to avoid persisting junk
      delete (data as Record<string, unknown>)["defaultTaxRate"];
    } else {
      // Keep a trimmed canonical numeric string (avoid trailing spaces)
      (data as Record<string, unknown>)["defaultTaxRate"] = String(n);
    }
  }

  // defaultPricesIncludeTax: normalize to "true" | "false"
  if (
    data &&
    Object.prototype.hasOwnProperty.call(data, "defaultPricesIncludeTax")
  ) {
    const v = String(
      (data as Record<string, unknown>)["defaultPricesIncludeTax"] ?? "",
    )
      .toLowerCase()
      .trim();
    const truthy = new Set(["1", "true", "yes", "y", "on"]);
    (data as Record<string, unknown>)["defaultPricesIncludeTax"] = truthy.has(v)
      ? "true"
      : "false";
  }

  // defaultRoundingMode: normalize to "line" | "total" (default line)
  if (
    data &&
    Object.prototype.hasOwnProperty.call(data, "defaultRoundingMode")
  ) {
    const v = String(
      (data as Record<string, unknown>)["defaultRoundingMode"] ?? "",
    )
      .toLowerCase()
      .trim();
    (data as Record<string, unknown>)["defaultRoundingMode"] = v === "total"
      ? "total"
      : "line";
  }
}

const SUPPORTED_LOCALES = new Set(availableInvoiceLocales());

function deriveLocaleFromCountryCode(countryCode?: string): string | undefined {
  if (!countryCode) return undefined;
  const code = String(countryCode).trim().toUpperCase();
  if (!code) return undefined;

  // Keep mapping constrained to currently supported invoice locales
  if (code === "DE" || code === "AT" || code === "CH") return "de";
  if (code === "NL" || code === "BE") return "nl";
  if (code === "PT" || code === "BR") return "pt-br";
  if (["AU", "CA", "GB", "IE", "NZ", "US", "AG", "BS", "BB", "BZ", "DM", "GD", "GY", "JM", "KN", "LC", "VC", "TT"].includes(code)) return "en";

  return undefined;
}

function resolveInvoiceRenderLocale(
  invoiceLocale: string | undefined,
  customerCountryCode: string | undefined,
  settingsLocale: string | undefined,
): string | undefined {
  const fromInvoice = invoiceLocale?.trim().toLowerCase();
  if (fromInvoice && SUPPORTED_LOCALES.has(fromInvoice)) return fromInvoice;

  const fromCountry = deriveLocaleFromCountryCode(customerCountryCode);
  if (fromCountry && SUPPORTED_LOCALES.has(fromCountry)) return fromCountry;

  const fromSettings = settingsLocale?.trim().toLowerCase();
  if (fromSettings && SUPPORTED_LOCALES.has(fromSettings)) return fromSettings;

  return "en";
}

function normalizeLocaleSettingPayload(data: Record<string, unknown>) {
  if (!data) return;

  // Accept common aliases and normalize to canonical keys
  if (
    !Object.prototype.hasOwnProperty.call(data, "dateFormat") &&
    Object.prototype.hasOwnProperty.call(data, "date_format")
  ) {
    (data as Record<string, unknown>).dateFormat = (
      data as Record<string, unknown>
    ).date_format;
    delete (data as Record<string, unknown>).date_format;
  }
  if (
    !Object.prototype.hasOwnProperty.call(data, "numberFormat") &&
    Object.prototype.hasOwnProperty.call(data, "number_format")
  ) {
    (data as Record<string, unknown>).numberFormat = (
      data as Record<string, unknown>
    ).number_format;
    delete (data as Record<string, unknown>).number_format;
  }

  // Accept common aliases and normalize to canonical key
  if (
    !Object.prototype.hasOwnProperty.call(data, "postalCityFormat") &&
    Object.prototype.hasOwnProperty.call(data, "postal_city_format")
  ) {
    (data as Record<string, unknown>).postalCityFormat = (
      data as Record<string, unknown>
    ).postal_city_format;
    delete (data as Record<string, unknown>).postal_city_format;
  }
  if (
    !Object.prototype.hasOwnProperty.call(data, "postalCityFormat") &&
    Object.prototype.hasOwnProperty.call(data, "postalcityformat")
  ) {
    (data as Record<string, unknown>).postalCityFormat = (
      data as Record<string, unknown>
    ).postalcityformat;
    delete (data as Record<string, unknown>).postalcityformat;
  }

  if (Object.prototype.hasOwnProperty.call(data, "locale")) {
    const raw = String((data as Record<string, unknown>).locale ?? "").trim();
    if (!raw) {
      delete (data as Record<string, unknown>).locale;
    } else {
      const lower = raw.toLowerCase();
      if (SUPPORTED_LOCALES.has(lower)) {
        (data as Record<string, unknown>).locale = lower;
      } else {
        const base = lower.split("-")[0];
        if (SUPPORTED_LOCALES.has(base)) {
          (data as Record<string, unknown>).locale = base;
        } else {
          (data as Record<string, unknown>).locale = "en";
        }
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "postalCityFormat")) {
    const rawFormat = String(data.postalCityFormat ?? "")
      .trim()
      .toLowerCase();
    if (rawFormat === "city-postal" || rawFormat === "postal-city") {
      (data as Record<string, unknown>).postalCityFormat = rawFormat;
    } else {
      (data as Record<string, unknown>).postalCityFormat = "auto";
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "numberFormat")) {
    const rawNumberFormat = String(data.numberFormat ?? "")
      .trim()
      .toLowerCase();
    (data as Record<string, unknown>).numberFormat =
      rawNumberFormat === "period" ? "period" : "comma";
  }

  if (Object.prototype.hasOwnProperty.call(data, "dateFormat")) {
    const rawDateFormat = String(data.dateFormat ?? "").trim();
    (data as Record<string, unknown>).dateFormat =
      rawDateFormat === "DD.MM.YYYY" ? "DD.MM.YYYY" : "YYYY-MM-DD";
  }
}

function normalizeInvoiceProtectionSettingsPayload(
  data: Record<string, unknown>,
) {
  if (
    !Object.prototype.hasOwnProperty.call(data, "allowProtectedInvoiceChanges")
  ) {
    return;
  }
  const raw = String(data.allowProtectedInvoiceChanges ?? "")
    .toLowerCase()
    .trim();
  const truthy = new Set(["1", "true", "yes", "y", "on"]);
  (data as Record<string, unknown>).allowProtectedInvoiceChanges = truthy.has(
      raw,
    )
    ? "true"
    : "false";
}

// Demo mode flag (mutations allowed; periodic resets handle reverting state)
const DEMO_MODE = isDemoMode();

adminRoutes.use("/invoices/*", requireAdminAuth);

adminRoutes.use("/customers/*", requireAdminAuth);

adminRoutes.use("/products/*", requireAdminAuth);

adminRoutes.use("/templates/*", requireAdminAuth);

adminRoutes.use("/tax-definitions/*", requireAdminAuth);

adminRoutes.use("/product-categories/*", requireAdminAuth);

adminRoutes.use("/product-units/*", requireAdminAuth);

adminRoutes.use("/settings", requireAdminAuth);

adminRoutes.use("/settings/*", requireAdminAuth);

// Protect admin alias routes as well
adminRoutes.use("/admin/*", requireAdminAuth);

// Protect export routes
adminRoutes.use("/export/*", requireAdminAuth);

// Demo helper: trigger an immediate reset (only effective when DEMO_MODE=true)
adminRoutes.post("/admin/demo/reset", async (c) => {
  if (!DEMO_MODE) return c.json({ error: "Demo mode is not enabled" }, 400);
  try {
    await resetDatabaseFromDemo();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Invoice routes
adminRoutes.get(
  "/invoices/next-number",
  requirePermission("invoices", "create"),
  (c) => {
    try {
      const next = getNextInvoiceNumber();
      return c.json({ next });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);
adminRoutes.post(
  "/invoices",
  requirePermission("invoices", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const invoice = createInvoice(data);
      return c.json(invoice);
    } catch (e) {
      const msg = String(e);
      if (/already exists/i.test(msg)) {
        return c.json({ error: msg }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.get("/invoices", requirePermission("invoices", "read"), (c) => {
  const invoices = getInvoices();

  // Look up payment methods for paid and complete invoices — complete invoices
  // were previously paid and their payment method should remain visible.
  const paidIds = invoices
    .filter((inv) => inv.status === "paid" || inv.status === "complete")
    .map((inv) => inv.id);
  const paymentMethods = getLatestPaidPaymentMethods(paidIds);

  const list = invoices.map((inv) => {
    let customerName: string | undefined = undefined;
    try {
      const customer = getCustomerById(inv.customerId);
      customerName = customer?.name;
    } catch (_e) {
      /* ignore */
    }
    const issue_date = inv.issueDate
      ? new Date(inv.issueDate).toISOString().slice(0, 10)
      : undefined;
    return {
      ...inv,
      customer: customerName ? { name: customerName } : undefined,
      issue_date,
      paidWith: paymentMethods.get(inv.id),
    } as unknown;
  });
  return c.json(list);
});

adminRoutes.get("/invoices/:id", requirePermission("invoices", "read"), (c) => {
  const id = c.req.param("id");
  const invoice = getInvoiceById(id);
  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404);
  }
  // Add snake_case date strings for UI compatibility (same as list endpoint)
  const issue_date = invoice.issueDate
    ? new Date(invoice.issueDate).toISOString().slice(0, 10)
    : undefined;
  const due_date = invoice.dueDate
    ? new Date(invoice.dueDate).toISOString().slice(0, 10)
    : undefined;
  return c.json({ ...invoice, issue_date, due_date });
});

adminRoutes.put(
  "/invoices/:id",
  requirePermission("invoices", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    try {
      const invoice = await updateInvoice(id, data);
      return c.json(invoice);
    } catch (e) {
      const msg = String(e);
      if (/already exists/i.test(msg)) {
        return c.json({ error: msg }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.delete(
  "/invoices/:id",
  requirePermission("invoices", "delete"),
  async (c) => {
    const id = c.req.param("id");
    try {
      await deleteInvoice(id);
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.post(
  "/invoices/:id/publish",
  requirePermission("invoices", "publish"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const result = await publishInvoice(id);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.post(
  "/invoices/:id/unpublish",
  requirePermission("invoices", "publish"),
  async (c) => {
    const id = c.req.param("id");
    const result = await unpublishInvoice(id);
    return c.json(result);
  },
);

adminRoutes.post(
  "/invoices/:id/duplicate",
  requirePermission("invoices", "create"),
  async (c) => {
    const id = c.req.param("id");
    const copy = await duplicateInvoice(id);
    if (!copy) return c.json({ error: "Invoice not found" }, 404);
    return c.json(copy);
  },
);

adminRoutes.post(
  "/invoices/:id/void",
  requirePermission("invoices", "void"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const result = await voidInvoice(id);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Template routes
adminRoutes.get(
  "/templates",
  requirePermission("templates", "read"),
  async (c) => {
    let templates = await getTemplates();
    // Overlay the default from settings if present; also compute 'updatable' flag when a manifest source exists
    try {
      const settings = await getSettings();
      const map = settings.reduce(
        (acc: Record<string, string>, s) => {
          acc[s.key] = s.value as string;
          return acc;
        },
        {} as Record<string, string>,
      );
      const current = map.templateId;
      if (current) {
        templates = templates.map((t) => ({
          ...t,
          isDefault: t.id === current,
          updatable: !!map[`templateSource:${t.id}`],
        }));
      } else {
        templates = templates.map((t) => ({
          ...t,
          updatable: !!map[`templateSource:${t.id}`],
        }));
      }
    } catch {
      /* ignore */
    }
    return c.json(templates);
  },
);

// Tax definition routes
adminRoutes.get(
  "/tax-definitions",
  requirePermission("tax_definitions", "read"),
  (c) => {
    try {
      const list = getTaxDefinitions();
      return c.json(list);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

adminRoutes.get(
  "/tax-definitions/:id",
  requirePermission("tax_definitions", "read"),
  (c) => {
    try {
      const id = c.req.param("id");
      const tax = getTaxDefinitionById(id);
      if (!tax) return c.json({ error: "Not found" }, 404);
      return c.json(tax);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

adminRoutes.post(
  "/tax-definitions",
  requirePermission("tax_definitions", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const created = createTaxDefinition(data);
      return c.json(created, 201);
    } catch (e) {
      const msg = String(e);
      if (/unique constraint failed: tax_definitions\.code/i.test(msg)) {
        return c.json({ error: "Tax code already exists" }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.put(
  "/tax-definitions/:id",
  requirePermission("tax_definitions", "update"),
  async (c) => {
    const data = await c.req.json();
    try {
      const id = c.req.param("id");
      const updated = updateTaxDefinition(id, data);
      return c.json(updated);
    } catch (e) {
      const msg = String(e);
      if (msg === "NOT_FOUND") return c.json({ error: "Not found" }, 404);
      if (/unique constraint failed: tax_definitions\.code/i.test(msg)) {
        return c.json({ error: "Tax code already exists" }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.delete(
  "/tax-definitions/:id",
  requirePermission("tax_definitions", "delete"),
  (c) => {
    try {
      const id = c.req.param("id");
      const result = deleteTaxDefinition(id);
      return c.json(result);
    } catch (e) {
      const msg = String(e);
      if (msg === "NOT_FOUND") return c.json({ error: "Not found" }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.post(
  "/templates",
  requirePermission("templates", "create"),
  async (c) => {
    const data = await c.req.json();
    const template = await createTemplate(data);
    return c.json(template);
  },
);

// Install a template from a remote manifest URL (YAML or JSON)
adminRoutes.post(
  "/templates/install-from-manifest",
  requirePermission("templates", "install"),
  async (c) => {
    try {
      const { url } = await c.req.json();
      if (!url || typeof url !== "string") {
        return c.json({ error: "Missing 'url'" }, 400);
      }
      const t = await installTemplateFromManifest(url);
      try {
        // Remember the source manifest used for this template id to enable future updates
        setSetting(`templateSource:${t.id}`, url);
      } catch (_e) {
        /* non-fatal */
      }
      return c.json(t);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Install a local template from an uploaded .zip file
adminRoutes.post(
  "/templates/upload",
  requirePermission("templates", "install"),
  async (c) => {
    try {
      const contentType = c.req.header("content-type") || "";

      let zipData: Uint8Array;

      if (contentType.includes("multipart/form-data")) {
        // Handle multipart form upload
        const formData = await c.req.formData();
        const file = formData.get("file");
        if (!file || !(file instanceof File)) {
          return c.json({ error: "No file uploaded" }, 400);
        }
        if (!file.name.endsWith(".zip")) {
          return c.json({ error: "File must be a .zip archive" }, 400);
        }
        if (file.size > 5 * 1024 * 1024) {
          return c.json({ error: "File too large (max 5MB)" }, 400);
        }
        const arrayBuffer = await file.arrayBuffer();
        zipData = new Uint8Array(arrayBuffer);
      } else if (
        contentType.includes("application/zip") ||
        contentType.includes("application/octet-stream")
      ) {
        // Handle raw binary upload
        const arrayBuffer = await c.req.arrayBuffer();
        if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
          return c.json({ error: "File too large (max 5MB)" }, 400);
        }
        zipData = new Uint8Array(arrayBuffer);
      } else {
        return c.json(
          {
            error:
              "Invalid content type. Expected multipart/form-data or application/zip",
          },
          400,
        );
      }

      const t = await installLocalTemplateFromZip(zipData);
      return c.json(t);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Update a template by id using its stored source manifest URL
adminRoutes.post(
  "/templates/:id/update",
  requirePermission("templates", "update"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const src = await getSetting(`templateSource:${id}`);
      if (!src || typeof src !== "string") {
        return c.json(
          { error: "No stored manifest URL for this template" },
          404,
        );
      }
      const updated = await installTemplateFromManifest(src);
      if (!updated || updated.id !== id) {
        return c.json({ error: "Manifest ID does not match template id" }, 400);
      }
      return c.json({ ok: true, template: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Delete a template (disallow removing built-in app templates)
adminRoutes.delete(
  "/templates/:id",
  requirePermission("templates", "delete"),
  async (c) => {
    const id = c.req.param("id");
    // Built-in templates are protected
    const builtin = new Set(["professional-modern", "minimalist-clean"]);
    if (builtin.has(id)) {
      return c.json({ error: "Cannot delete built-in templates" }, 400);
    }

    // If this template is currently selected in settings, reset to minimalist-clean
    try {
      const current = await getSetting("templateId");
      if (current === id) {
        await setSetting("templateId", "minimalist-clean");
      }
    } catch (_e) {
      // non-fatal
    }

    try {
      await deleteTemplate(id);
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

// Get template by ID
adminRoutes.get(
  "/templates/:id",
  requirePermission("templates", "read"),
  (c) => {
    const id = c.req.param("id");
    const template = getTemplateById(id);
    if (!template) {
      return c.json({ error: "Template not found" }, 404);
    }
    return c.json(template);
  },
);

// Preview template with sample data
adminRoutes.post(
  "/templates/:id/preview",
  requirePermission("templates", "read"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();

    const template = getTemplateById(id);
    if (!template) {
      return c.json({ error: "Template not found" }, 404);
    }

    // Add sample data if not provided
    const sampleData = {
      companyName: "Sample Company Inc",
      companyAddress: "123 Business St, City, State 12345",
      companyEmail: "contact@sample.com",
      companyPhone: "+1-555-123-4567",
      companyTaxId: "TAX123456",
      invoiceNumber: "INV-2025-001",
      issueDate: "2025-08-26",
      dueDate: "2025-09-25",
      currency: "USD",
      status: "draft",
      customerName: "John Doe",
      customerEmail: "john@example.com",
      customerAddress: "456 Client Ave, City, State 54321",
      customerPostalCity: "54321 City",
      customerCountryCode: "US",
      highlightColor: data.highlightColor || "#2563eb",
      highlightColorLight: data.highlightColorLight || "#dbeafe",
      subtotal: 2500.0,
      discountAmount: 250.0,
      discountPercentage: 10,
      taxRate: 8.5,
      taxAmount: 191.25,
      total: 2441.25,
      hasDiscount: true,
      hasTax: true,

      items: [
        {
          description: "Website Development",
          quantity: 1,
          unitPrice: 2500.0,
          lineTotal: 2500.0,
          notes: "Custom responsive website with modern design",
        },
      ],
      notes: "Thank you for your business! Payment is due within 30 days.",
      paymentTerms: "Net 30 days",
      paymentMethods: "Bank Transfer, Credit Card",
      bankAccount: "Account: 123-456-789, Routing: 987-654-321",
      ...data,
    };

    try {
      const renderedHtml = renderTemplate(template.html, sampleData);
      return new Response(renderedHtml, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      return c.json(
        {
          error: "Failed to render template",
          details: String(error),
        },
        500,
      );
    }
  },
);

// Load template from file
adminRoutes.post(
  "/templates/load-from-file",
  requirePermission("templates", "create"),
  async (c) => {
    try {
      const { filePath, name, isDefault, highlightColor } = await c.req.json();

      const html = await loadTemplateFromFile(filePath);
      const template = await createTemplate({
        name,
        html,
        isDefault: isDefault || false,
      });

      return c.json({
        ...template,
        highlightColor: highlightColor || "#2563eb",
        message: "Template loaded successfully from file",
      });
    } catch (error) {
      return c.json(
        {
          error: "Failed to load template from file",
          details: String(error),
        },
        500,
      );
    }
  },
);

// Settings routes
adminRoutes.get("/settings", async (c) => {
  const settings = await getSettings();
  const map = settings.reduce(
    (acc: Record<string, string>, s) => {
      acc[s.key] = s.value as string;
      return acc;
    },
    {} as Record<string, string>,
  );
  // Provide normalized aliases expected by the frontend
  if (map.companyEmail && !map.email) map.email = map.companyEmail;
  if (map.companyPhone && !map.phone) map.phone = map.companyPhone;
  if (map.companyTaxId && !map.taxId) map.taxId = map.companyTaxId;
  if (map.companyCountryCode && !map.countryCode) {
    map.countryCode = map.companyCountryCode;
  }
  // Unify logo fields: prefer single 'logo'; hide legacy 'logoUrl'
  if (map.logoUrl && !map.logo) map.logo = map.logoUrl;
  if (map.logoUrl) delete map.logoUrl;
  if (typeof map.logo === "string") {
    map.logo = normalizeStoredLogoReference(map.logo);
  }
  if (!map.locale) map.locale = "en";
  if (!map.dateFormat && map.date_format) map.dateFormat = map.date_format;
  if (!map.numberFormat && map.number_format) {
    map.numberFormat = map.number_format;
  }
  if (!map.postalCityFormat && map.postal_city_format) {
    map.postalCityFormat = map.postal_city_format;
  }
  if (!map.postalCityFormat && map.postalcityformat) {
    map.postalCityFormat = map.postalcityformat;
  }
  if (!map.dateFormat) map.dateFormat = "YYYY-MM-DD";
  if (!map.numberFormat) map.numberFormat = "comma";
  if (!map.postalCityFormat) map.postalCityFormat = "auto";
  if (!map.allowProtectedInvoiceChanges) {
    map.allowProtectedInvoiceChanges = "false";
  }
  // Expose demo mode to frontend UI
  (map as Record<string, unknown>).demoMode = DEMO_MODE ? "true" : "false";
  return c.json(map);
});

adminRoutes.put(
  "/settings",
  requirePermission("settings", "update"),
  async (c) => {
    const data = await c.req.json();
    // Normalize legacy logoUrl to logo
    if (typeof data.logoUrl === "string" && !data.logo) {
      data.logo = data.logoUrl;
      delete data.logoUrl;
    }
    if (typeof data.logo === "string" && data.logo.startsWith("data:image/")) {
      data.logo = await saveDataUrlLogo(data.logo);
    } else if (typeof data.logo === "string") {
      data.logo = normalizeStoredLogoReference(data.logo);
    }
    // Normalize tax-related settings
    normalizeTaxSettingsPayload(data);
    normalizeLocaleSettingPayload(data);
    normalizeInvoiceProtectionSettingsPayload(data);
    const settings = await updateSettings(data);
    try {
      if ("logoUrl" in data) deleteSetting("logoUrl");
    } catch (_e) {
      /* ignore legacy cleanup errors */
    }
    // If default template changed, reflect in templates table
    if (typeof data.templateId === "string" && data.templateId) {
      try {
        setDefaultTemplate(String(data.templateId));
      } catch {
        /* ignore */
      }
    }
    return c.json(settings);
  },
);

// Partial update (PATCH) to merge provided keys only
adminRoutes.patch(
  "/settings",
  requirePermission("settings", "update"),
  async (c) => {
    const data = await c.req.json();
    // Normalize legacy logoUrl to logo
    if (typeof data.logoUrl === "string" && !data.logo) {
      data.logo = data.logoUrl;
      delete data.logoUrl;
    }
    if (typeof data.logo === "string" && data.logo.startsWith("data:image/")) {
      data.logo = await saveDataUrlLogo(data.logo);
    } else if (typeof data.logo === "string") {
      data.logo = normalizeStoredLogoReference(data.logo);
    }
    // Normalize countryCode alias to companyCountryCode
    if (typeof data.countryCode === "string" && !data.companyCountryCode) {
      data.companyCountryCode = data.countryCode;
      delete data.countryCode;
    }
    // Normalize tax-related settings
    normalizeTaxSettingsPayload(data);
    normalizeLocaleSettingPayload(data);
    normalizeInvoiceProtectionSettingsPayload(data);
    const settings = await updateSettings(data);
    if (typeof data.templateId === "string" && data.templateId) {
      try {
        setDefaultTemplate(String(data.templateId));
      } catch {
        /* ignore */
      }
    }
    try {
      if ("logoUrl" in data) deleteSetting("logoUrl");
    } catch (_e) {
      /* ignore legacy cleanup errors */
    }
    return c.json(settings);
  },
);

adminRoutes.post(
  "/settings/logo-upload",
  requirePermission("settings", "update"),
  async (c) => {
    try {
      const form = await c.req.formData();
      const entry = form.get("file");
      if (!(entry instanceof File)) {
        return c.json({ error: "Missing file" }, 400);
      }
      const logo = await saveUploadedLogoFile(entry);
      return c.json({ logo });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Optional admin-prefixed aliases for clarity/documentation parity
adminRoutes.get("/admin/settings", async (c) => {
  const settings = await getSettings();
  const map = settings.reduce(
    (acc: Record<string, string>, s) => {
      acc[s.key] = s.value as string;
      return acc;
    },
    {} as Record<string, string>,
  );
  if (map.companyEmail && !map.email) map.email = map.companyEmail;
  if (map.companyPhone && !map.phone) map.phone = map.companyPhone;
  if (map.companyTaxId && !map.taxId) map.taxId = map.companyTaxId;
  if (map.companyCountryCode && !map.countryCode) {
    map.countryCode = map.companyCountryCode;
  }
  if (map.logoUrl && !map.logo) map.logo = map.logoUrl;
  if (map.logoUrl) delete map.logoUrl;
  if (typeof map.logo === "string") {
    map.logo = normalizeStoredLogoReference(map.logo);
  }
  if (!map.locale) map.locale = "en";
  if (!map.dateFormat && map.date_format) map.dateFormat = map.date_format;
  if (!map.numberFormat && map.number_format) {
    map.numberFormat = map.number_format;
  }
  if (!map.postalCityFormat && map.postal_city_format) {
    map.postalCityFormat = map.postal_city_format;
  }
  if (!map.postalCityFormat && map.postalcityformat) {
    map.postalCityFormat = map.postalcityformat;
  }
  if (!map.dateFormat) map.dateFormat = "YYYY-MM-DD";
  if (!map.numberFormat) map.numberFormat = "comma";
  if (!map.postalCityFormat) map.postalCityFormat = "auto";
  if (!map.allowProtectedInvoiceChanges) {
    map.allowProtectedInvoiceChanges = "false";
  }
  // Expose demo mode to frontend UI for admin-prefixed route as well
  (map as Record<string, unknown>).demoMode = DEMO_MODE ? "true" : "false";
  return c.json(map);
});

adminRoutes.put(
  "/admin/settings",
  requirePermission("settings", "update"),
  async (c) => {
    const data = await c.req.json();
    if (typeof data.logoUrl === "string" && !data.logo) {
      data.logo = data.logoUrl;
      delete data.logoUrl;
    }
    if (typeof data.logo === "string" && data.logo.startsWith("data:image/")) {
      data.logo = await saveDataUrlLogo(data.logo);
    } else if (typeof data.logo === "string") {
      data.logo = normalizeStoredLogoReference(data.logo);
    }
    // Normalize tax-related settings
    normalizeTaxSettingsPayload(data);
    normalizeLocaleSettingPayload(data);
    normalizeInvoiceProtectionSettingsPayload(data);
    const settings = await updateSettings(data);
    try {
      if ("logoUrl" in data) deleteSetting("logoUrl");
    } catch (_e) {
      /* ignore legacy cleanup errors */
    }
    return c.json(settings);
  },
);

adminRoutes.patch(
  "/admin/settings",
  requirePermission("settings", "update"),
  async (c) => {
    const data = await c.req.json();
    if (typeof data.logoUrl === "string" && !data.logo) {
      data.logo = data.logoUrl;
      delete data.logoUrl;
    }
    if (typeof data.logo === "string" && data.logo.startsWith("data:image/")) {
      data.logo = await saveDataUrlLogo(data.logo);
    } else if (typeof data.logo === "string") {
      data.logo = normalizeStoredLogoReference(data.logo);
    }
    // Normalize tax-related settings
    normalizeTaxSettingsPayload(data);
    normalizeLocaleSettingPayload(data);
    normalizeInvoiceProtectionSettingsPayload(data);
    const settings = await updateSettings(data);
    try {
      if ("logoUrl" in data) deleteSetting("logoUrl");
    } catch (_e) {
      /* ignore legacy cleanup errors */
    }
    return c.json(settings);
  },
);

// Customer routes
adminRoutes.get(
  "/customers",
  requirePermission("customers", "read"),
  async (c) => {
    const customers = await getCustomers();
    return c.json(customers);
  },
);

adminRoutes.get(
  "/customers/:id",
  requirePermission("customers", "read"),
  async (c) => {
    const id = c.req.param("id");
    const customer = await getCustomerById(id);
    if (!customer) {
      return c.json({ error: "Customer not found" }, 404);
    }
    return c.json(customer);
  },
);

adminRoutes.post(
  "/customers",
  requirePermission("customers", "create"),
  async (c) => {
    const data = await c.req.json();
    const customer = createCustomer(data);
    return c.json(customer);
  },
);

adminRoutes.put(
  "/customers/:id",
  requirePermission("customers", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    const customer = await updateCustomer(id, data);
    return c.json(customer);
  },
);

adminRoutes.delete(
  "/customers/:id",
  requirePermission("customers", "delete"),
  async (c) => {
    const id = c.req.param("id");
    await deleteCustomer(id);
    return c.json({ success: true });
  },
);

// Product routes
adminRoutes.get("/products", requirePermission("products", "read"), (c) => {
  const url = new URL(c.req.url);
  const includeInactive =
    url.searchParams.get("includeInactive")?.toLowerCase() === "true";
  const products = getProducts(includeInactive);
  return c.json(products);
});

adminRoutes.get("/products/:id", requirePermission("products", "read"), (c) => {
  const id = c.req.param("id");
  const product = getProductById(id);
  if (!product) {
    return c.json({ error: "Product not found" }, 404);
  }
  return c.json(product);
});

adminRoutes.post(
  "/products",
  requirePermission("products", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const product = createProduct(data);
      return c.json(product, 201);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.put(
  "/products/:id",
  requirePermission("products", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    try {
      const product = updateProduct(id, data);
      if (!product) {
        return c.json({ error: "Product not found" }, 404);
      }
      return c.json(product);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.delete(
  "/products/:id",
  requirePermission("products", "delete"),
  (c) => {
    const id = c.req.param("id");
    try {
      deleteProduct(id);
      return c.json({ success: true });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("not found")) {
        return c.json({ error: "Product not found" }, 404);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

// Check if product is used in invoices
adminRoutes.get(
  "/products/:id/usage",
  requirePermission("products", "read"),
  (c) => {
    const id = c.req.param("id");
    const product = getProductById(id);
    if (!product) {
      return c.json({ error: "Product not found" }, 404);
    }
    const usedInInvoices = isProductUsedInInvoices(id);
    return c.json({ usedInInvoices });
  },
);

// Reactivate a soft-deleted product
adminRoutes.post(
  "/products/:id/reactivate",
  requirePermission("products", "update"),
  (c) => {
    const id = c.req.param("id");
    try {
      const product = reactivateProduct(id);
      if (!product) {
        return c.json({ error: "Product not found" }, 404);
      }
      return c.json(product);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Product Categories
adminRoutes.get(
  "/product-categories",
  requirePermission("products", "read"),
  (c) => {
    const categories = getCategories();
    return c.json(categories);
  },
);

adminRoutes.get(
  "/product-categories/:id",
  requirePermission("products", "read"),
  (c) => {
    if (!category) {
      return c.json({ error: "Category not found" }, 404);
    }
    return c.json(category);
  },
);

adminRoutes.post(
  "/product-categories",
  requirePermission("products", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const category = createCategory(data);
      return c.json(category, 201);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.put(
  "/product-categories/:id",
  requirePermission("products", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    try {
      const category = updateCategory(id, data);
      if (!category) {
        return c.json({ error: "Category not found" }, 404);
      }
      return c.json(category);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.delete(
  "/product-categories/:id",
  requirePermission("products", "delete"),
  (c) => {
    const id = c.req.param("id");
    try {
      const deleted = deleteCategory(id);
      if (!deleted) {
        return c.json({ error: "Category not found" }, 404);
      }
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.get(
  "/product-categories/:id/usage",
  requirePermission("products", "read"),
  (c) => {
    const id = c.req.param("id");
    const usage = isCategoryUsed(id);
    return c.json(usage);
  },
);

// Product Units
adminRoutes.get(
  "/product-units",
  requirePermission("products", "read"),
  (c) => {
    const units = getUnits();
    return c.json(units);
  },
);

adminRoutes.get(
  "/product-units/:id",
  requirePermission("products", "read"),
  (c) => {
    if (!unit) {
      return c.json({ error: "Unit not found" }, 404);
    }
    return c.json(unit);
  },
);

adminRoutes.post(
  "/product-units",
  requirePermission("products", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const unit = createUnit(data);
      return c.json(unit, 201);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.put(
  "/product-units/:id",
  requirePermission("products", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    try {
      const unit = updateUnit(id, data);
      if (!unit) {
        return c.json({ error: "Unit not found" }, 404);
      }
      return c.json(unit);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.delete(
  "/product-units/:id",
  requirePermission("products", "delete"),
  (c) => {
    const id = c.req.param("id");
    try {
      const deleted = deleteUnit(id);
      if (!deleted) {
        return c.json({ error: "Unit not found" }, 404);
      }
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.get(
  "/product-units/:id/usage",
  requirePermission("products", "read"),
  (c) => {
    const id = c.req.param("id");
    const usage = isUnitUsed(id);
    return c.json(usage);
  },
);

// Authenticated HTML/PDF generation for invoices by ID (no share token required)
adminRoutes.get(
  "/invoices/:id/html",
  requirePermission("invoices", "read"),
  async (c) => {
    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) {
      return c.json({ message: "Invoice not found" }, 404);
    }

    // Settings map
    const settings = await getSettings();
    const settingsMap = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );
    if (!settingsMap.postalCityFormat && settingsMap.postal_city_format) {
      settingsMap.postalCityFormat = settingsMap.postal_city_format;
    }
    if (!settingsMap.postalCityFormat && settingsMap.postalcityformat) {
      settingsMap.postalCityFormat = settingsMap.postalcityformat;
    }
    if (!settingsMap.logo && settingsMap.logoUrl) {
      settingsMap.logo = settingsMap.logoUrl;
    }

    const businessSettings = {
      companyName: settingsMap.companyName || "Your Company",
      companyAddress: settingsMap.companyAddress || "",
      companyCity: settingsMap.companyCity || "",
      companyPostalCode: settingsMap.companyPostalCode || "",
      companyCountryCode: settingsMap.companyCountryCode || "",
      postalCityFormat: settingsMap.postalCityFormat || "auto",
      companyEmail: settingsMap.companyEmail || "",
      companyPhone: settingsMap.companyPhone || "",
      companyTaxId: settingsMap.companyTaxId || "",
      currency: settingsMap.currency || "USD",
      taxLabel: settingsMap.taxLabel || undefined,
      logo: settingsMap.logo,
      // brandLayout removed; always treating as logo-left in rendering
      paymentMethods: settingsMap.paymentMethods || "Bank Transfer",
      bankAccount: settingsMap.bankAccount || "",
      paymentTerms: settingsMap.paymentTerms || "Due in 30 days",
      defaultNotes: settingsMap.defaultNotes || "",
      locale: settingsMap.locale || undefined,
    };

    // Use template/highlight from settings only (no query overrides)
    const highlight = settingsMap.highlight ?? undefined;
    let selectedTemplateId: string | undefined = settingsMap.templateId
      ?.toLowerCase();
    if (
      selectedTemplateId === "professional" ||
      selectedTemplateId === "professional-modern"
    ) {
      selectedTemplateId = "professional-modern";
    } else if (
      selectedTemplateId === "minimalist" ||
      selectedTemplateId === "minimalist-clean"
    ) {
      selectedTemplateId = "minimalist-clean";
    }

    const customer = getCustomerById(invoice.customerId);
    const renderLocale = resolveInvoiceRenderLocale(
      invoice.locale,
      customer?.countryCode,
      settingsMap.locale,
    );

    const html = buildInvoiceHTML(
      invoice,
      businessSettings,
      selectedTemplateId,
      highlight,
      settingsMap.dateFormat,
      settingsMap.numberFormat,
      renderLocale,
    );
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
);

adminRoutes.get(
  "/invoices/:id/pdf",
  requirePermission("invoices", "export"),
  async (c) => {
    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) {
      return c.json({ message: "Invoice not found" }, 404);
    }

    // Settings map
    const settings = await getSettings();
    const settingsMap = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );
    if (!settingsMap.postalCityFormat && settingsMap.postal_city_format) {
      settingsMap.postalCityFormat = settingsMap.postal_city_format;
    }
    if (!settingsMap.postalCityFormat && settingsMap.postalcityformat) {
      settingsMap.postalCityFormat = settingsMap.postalcityformat;
    }
    if (!settingsMap.logo && settingsMap.logoUrl) {
      settingsMap.logo = settingsMap.logoUrl;
    }

    const businessSettings = {
      companyName: settingsMap.companyName || "Your Company",
      companyAddress: settingsMap.companyAddress || "",
      companyCity: settingsMap.companyCity || "",
      companyPostalCode: settingsMap.companyPostalCode || "",
      companyCountryCode: settingsMap.companyCountryCode || "",
      postalCityFormat: settingsMap.postalCityFormat || "auto",
      companyEmail: settingsMap.companyEmail || "",
      companyPhone: settingsMap.companyPhone || "",
      companyTaxId: settingsMap.companyTaxId || "",
      currency: settingsMap.currency || "USD",
      taxLabel: settingsMap.taxLabel || undefined,
      logo: settingsMap.logo,
      // brandLayout removed; always treating as logo-left in rendering
      paymentMethods: settingsMap.paymentMethods || "Bank Transfer",
      bankAccount: settingsMap.bankAccount || "",
      paymentTerms: settingsMap.paymentTerms || "Due in 30 days",
      defaultNotes: settingsMap.defaultNotes || "",
      locale: settingsMap.locale || undefined,
    };

    // Use template/highlight from settings only (no query overrides)
    const highlight = settingsMap.highlight ?? undefined;
    let selectedTemplateId: string | undefined = settingsMap.templateId
      ?.toLowerCase();
    if (
      selectedTemplateId === "professional" ||
      selectedTemplateId === "professional-modern"
    ) {
      selectedTemplateId = "professional-modern";
    } else if (
      selectedTemplateId === "minimalist" ||
      selectedTemplateId === "minimalist-clean"
    ) {
      selectedTemplateId = "minimalist-clean";
    }

    try {
      const embedXml =
        String(settingsMap.embedXmlInPdf || "false").toLowerCase() === "true";
      const xmlProfileId = settingsMap.xmlProfileId || "ubl21";
      const customer = getCustomerById(invoice.customerId);
      const renderLocale = resolveInvoiceRenderLocale(
        invoice.locale,
        customer?.countryCode,
        settingsMap.locale,
      );

      const pdfBuffer = await generatePDF(
        invoice,
        businessSettings,
        selectedTemplateId,
        highlight,
        {
          embedXml,
          embedXmlProfileId: xmlProfileId,
          dateFormat: settingsMap.dateFormat,
          numberFormat: settingsMap.numberFormat,
          locale: renderLocale,
        },
      );
      // Detect embedded attachments for diagnostics
      let hasAttachment = false;
      let attachmentNames: string[] = [];
      try {
        // Dynamically import to avoid import cycles
        const { PDFDocument } = await import("pdf-lib");
        const doc = await PDFDocument.load(pdfBuffer);
        const maybe = (
          doc as unknown as {
            getAttachments?: () => Record<string, Uint8Array>;
          }
        ).getAttachments?.();
        if (maybe && typeof maybe === "object") {
          attachmentNames = Object.keys(maybe);
          hasAttachment = attachmentNames.length > 0;
        }
      } catch (_e) {
        /* ignore */
      }
      return new Response(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="invoice-${
            invoice.invoiceNumber || id
          }.pdf"`,
          ...(hasAttachment
            ? {
              "X-Embedded-XML": "true",
              "X-Embedded-XML-Names": attachmentNames.join(","),
            }
            : { "X-Embedded-XML": "false" }),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("/invoices/:id/pdf failed:", msg);
      return c.json({ error: "Failed to generate PDF", details: msg }, 500);
    }
  },
);

// Send invoice via email (SMTP2GO)
adminRoutes.post(
  "/invoices/:id/send-email",
  requirePermission("invoices", "export"),
  async (c) => {
    if (!isEmailConfigured()) {
      return c.json(
        { error: "Email is not configured. Set SMTP2GO_API_KEY and EMAIL_FROM_ADDRESS." },
        503,
      );
    }

    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);

    let to: string[] = [];
    let subject = "";
    let message = "";
    try {
      const body = await c.req.json();
      to = Array.isArray(body.to) ? body.to.filter((e: unknown) => typeof e === "string" && e.includes("@")) : [];
      subject = typeof body.subject === "string" ? body.subject.trim() : "";
      message = typeof body.message === "string" ? body.message.trim() : "";
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    if (to.length === 0) {
      return c.json({ error: "At least one valid recipient email is required" }, 400);
    }
    if (!subject) {
      return c.json({ error: "Subject is required" }, 400);
    }

    // Build settings map (same as /pdf route)
    const settings = await getSettings();
    const settingsMap = settings.reduce(
      (acc: Record<string, string>, s) => { acc[s.key] = s.value as string; return acc; },
      {} as Record<string, string>,
    );
    if (!settingsMap.postalCityFormat && settingsMap.postal_city_format) {
      settingsMap.postalCityFormat = settingsMap.postal_city_format;
    }
    if (!settingsMap.logo && settingsMap.logoUrl) {
      settingsMap.logo = settingsMap.logoUrl;
    }

    const businessSettings = {
      companyName: settingsMap.companyName || "Your Company",
      companyAddress: settingsMap.companyAddress || "",
      companyCity: settingsMap.companyCity || "",
      companyPostalCode: settingsMap.companyPostalCode || "",
      companyCountryCode: settingsMap.companyCountryCode || "",
      postalCityFormat: settingsMap.postalCityFormat || "auto",
      companyEmail: settingsMap.companyEmail || "",
      companyPhone: settingsMap.companyPhone || "",
      companyTaxId: settingsMap.companyTaxId || "",
      currency: settingsMap.currency || "USD",
      taxLabel: settingsMap.taxLabel || undefined,
      logo: settingsMap.logo,
      paymentMethods: settingsMap.paymentMethods || "Bank Transfer",
      bankAccount: settingsMap.bankAccount || "",
      paymentTerms: settingsMap.paymentTerms || "Due in 30 days",
      defaultNotes: settingsMap.defaultNotes || "",
      locale: settingsMap.locale || undefined,
    };

    const highlight = settingsMap.highlight ?? undefined;
    let selectedTemplateId: string | undefined = settingsMap.templateId?.toLowerCase();
    if (selectedTemplateId === "professional" || selectedTemplateId === "professional-modern") {
      selectedTemplateId = "professional-modern";
    } else if (selectedTemplateId === "minimalist" || selectedTemplateId === "minimalist-clean") {
      selectedTemplateId = "minimalist-clean";
    }

    // Generate PDF attachment
    let pdfBuffer: Uint8Array;
    try {
      const customer = getCustomerById(invoice.customerId);
      const renderLocale = resolveInvoiceRenderLocale(
        invoice.locale,
        customer?.countryCode,
        settingsMap.locale,
      );
      pdfBuffer = await generatePDF(
        invoice,
        businessSettings,
        selectedTemplateId,
        highlight,
        {
          embedXml: false,
          dateFormat: settingsMap.dateFormat,
          numberFormat: settingsMap.numberFormat,
          locale: renderLocale,
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Email: PDF generation failed:", msg);
      return c.json({ error: "Failed to generate PDF attachment", details: msg }, 500);
    }

    // Build email body
    const companyName = businessSettings.companyName;
    const invoiceNumber = invoice.invoiceNumber || invoice.id;
    const total = `${Number(invoice.total || 0).toFixed(2)} ${invoice.currency || ""}`.trim();
    const issueDate = invoice.issueDate
      ? new Date(invoice.issueDate).toISOString().slice(0, 10)
      : "";
    const dueDate = invoice.dueDate
      ? new Date(invoice.dueDate).toISOString().slice(0, 10)
      : null;
    const origin = c.req.header("origin") ||
      c.req.header("referer")?.replace(/\/$/, "") || "";
    const shareLink = invoice.shareToken && origin
      ? `${origin}/public/invoices/${invoice.shareToken}`
      : null;

    const messageHtml = message
      ? `<p style="white-space:pre-wrap;">${message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`
      : "";
    const shareLinkHtml = shareLink
      ? `<p><a href="${shareLink}" style="color:#2563eb;">View invoice online</a></p>`
      : "";
    const dueDateHtml = dueDate ? `<tr><td style="padding:4px 8px;color:#6b7280;">Due date</td><td style="padding:4px 8px;">${dueDate}</td></tr>` : "";

    const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="margin-top:0;">${companyName}</h2>
  ${messageHtml}
  <table style="border-collapse:collapse;margin:16px 0;width:auto;">
    <tr><td style="padding:4px 8px;color:#6b7280;">Invoice</td><td style="padding:4px 8px;font-weight:600;">#${invoiceNumber}</td></tr>
    <tr><td style="padding:4px 8px;color:#6b7280;">Issue date</td><td style="padding:4px 8px;">${issueDate}</td></tr>
    ${dueDateHtml}
    <tr><td style="padding:4px 8px;color:#6b7280;">Total</td><td style="padding:4px 8px;font-weight:600;">${total}</td></tr>
  </table>
  ${shareLinkHtml}
  <p style="color:#6b7280;font-size:13px;">The invoice PDF is attached to this email.</p>
</body>
</html>`;

    const textBody = [
      companyName,
      "",
      message || "",
      `Invoice: #${invoiceNumber}`,
      `Issue date: ${issueDate}`,
      dueDate ? `Due date: ${dueDate}` : "",
      `Total: ${total}`,
      shareLink ? `\nView online: ${shareLink}` : "",
    ].filter((l) => l !== undefined).join("\n").trim();

    try {
      await sendEmail({
        to,
        subject,
        htmlBody,
        textBody,
        attachment: {
          filename: `invoice-${invoiceNumber}.pdf`,
          content: pdfBuffer,
          mimeType: "application/pdf",
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Email send failed:", msg);
      return c.json({ error: "Failed to send email", details: msg }, 502);
    }

    return c.json({ sent: true, recipients: to.length });
  },
);

// UBL (PEPPOL BIS Billing 3.0) XML for an invoice by ID
adminRoutes.get(
  "/invoices/:id/ubl.xml",
  requirePermission("invoices", "export"),
  async (c) => {
    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) {
      return c.json({ message: "Invoice not found" }, 404);
    }

    const settings = await getSettings();
    const map = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );

    const businessSettings = {
      companyName: map.companyName || "Your Company",
      companyAddress: map.companyAddress || "",
      companyCity: map.companyCity || "",
      companyPostalCode: map.companyPostalCode || "",
      companyEmail: map.companyEmail || "",
      companyPhone: map.companyPhone || "",
      companyTaxId: map.companyTaxId || "",
      currency: map.currency || "USD",
      logo: map.logo,
      paymentMethods: map.paymentMethods || "Bank Transfer",
      bankAccount: map.bankAccount || "",
      paymentTerms: map.paymentTerms || "Due in 30 days",
      defaultNotes: map.defaultNotes || "",
      companyCountryCode: map.companyCountryCode || "",
    };

    // Optional PEPPOL endpoint IDs if configured in settings
    const xml = generateUBLInvoiceXML(invoice, businessSettings, {
      sellerEndpointId: map.peppolSellerEndpointId,
      sellerEndpointSchemeId: map.peppolSellerEndpointSchemeId,
      buyerEndpointId: map.peppolBuyerEndpointId,
      buyerEndpointSchemeId: map.peppolBuyerEndpointSchemeId,
      sellerCountryCode: map.companyCountryCode,
      buyerCountryCode: invoice.customer.countryCode,
    });

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="invoice-${
          invoice.invoiceNumber || id
        }.xml"`,
      },
    });
  },
);

// Generic XML export selecting an internal profile (?profile=ubl21 or stub-generic)
adminRoutes.get(
  "/invoices/:id/xml",
  requirePermission("invoices", "export"),
  async (c) => {
    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) return c.json({ message: "Invoice not found" }, 404);

    const settings = await getSettings();
    const map = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );

    const businessSettings = {
      companyName: map.companyName || "Your Company",
      companyAddress: map.companyAddress || "",
      companyCity: map.companyCity || "",
      companyPostalCode: map.companyPostalCode || "",
      companyEmail: map.companyEmail || "",
      companyPhone: map.companyPhone || "",
      companyTaxId: map.companyTaxId || "",
      currency: map.currency || "USD",
      logo: map.logo,
      paymentMethods: map.paymentMethods || "Bank Transfer",
      bankAccount: map.bankAccount || "",
      paymentTerms: map.paymentTerms || "Due in 30 days",
      defaultNotes: map.defaultNotes || "",
      companyCountryCode: map.companyCountryCode || "",
    };

    const url = new URL(c.req.url);
    const profileParam = url.searchParams.get("profile") || map.xmlProfileId ||
      undefined;
    const { xml, profile } = generateInvoiceXML(
      profileParam,
      invoice,
      businessSettings,
      {
        sellerEndpointId: map.peppolSellerEndpointId,
        sellerEndpointSchemeId: map.peppolSellerEndpointSchemeId,
        buyerEndpointId: map.peppolBuyerEndpointId,
        buyerEndpointSchemeId: map.peppolBuyerEndpointSchemeId,
        sellerCountryCode: map.companyCountryCode,
        buyerCountryCode: invoice.customer.countryCode,
      },
    );

    return new Response(xml, {
      headers: {
        "Content-Type": `${profile.mediaType}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="invoice-${
          invoice.invoiceNumber || id
        }.${profile.fileExtension}"`,
      },
    });
  },
);

// List built-in XML profiles
adminRoutes.get("/xml-profiles", requirePermission("invoices", "read"), (c) => {
  const profiles = listXMLProfiles().map((p) => ({
    id: p.id,
    name: p.name,
    mediaType: p.mediaType,
    fileExtension: p.fileExtension,
    experimental: !!p.experimental,
    builtIn: true,
  }));
  return c.json(profiles);
});

// =============================================
// User management routes
// =============================================
adminRoutes.use("/users/*", requireAdminAuth);

// GET /users/me — current authenticated user (any authenticated user)
adminRoutes.get("/users/me", (c) => {
  const user = getAuthUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  // Return user info with permissions and available RESOURCE_ACTIONS map
  return c.json({
    ...user,
    availableResources: RESOURCE_ACTIONS,
  });
});

adminRoutes.post("/users/me/2fa/setup", (c) => {
  if (DEMO_MODE) {
    return c.json({ error: "2FA is not available in demo mode" }, 403);
  }
  const user = getAuthUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  const setup = createPendingTwoFactorSetup(user.id, user.username);
  return c.json({
    otpAuthUrl: setup.otpAuthUrl,
    expiresIn: setup.expiresIn,
  });
});

adminRoutes.post("/users/me/2fa/verify", async (c) => {
  if (DEMO_MODE) {
    return c.json({ error: "2FA is not available in demo mode" }, 403);
  }
  const user = getAuthUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  let token: string | undefined;
  try {
    const body = await c.req.json();
    if (body && typeof body.token === "string") token = body.token;
  } catch {
    // ignore parse errors
  }
  if (!token) return c.json({ error: "Missing 2FA token" }, 400);

  const result = verifyPendingTwoFactorSetup(user.id, user.username, token);
  if (!result.ok) return c.json({ error: result.reason }, 400);

  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes);
  const encryptedSecret = await encryptTwoFactorSecret(result.secretBase32);
  setUserTwoFactorState(user.id, encryptedSecret, recoveryCodeHashes);

  return c.json({
    twoFactorEnabled: true,
    recoveryCodes,
  });
});

adminRoutes.delete("/users/me/2fa", async (c) => {
  if (DEMO_MODE) {
    return c.json({ error: "2FA is not available in demo mode" }, 403);
  }
  const user = getAuthUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);

  let token: string | undefined;
  try {
    const body = await c.req.json();
    if (body && typeof body.token === "string") token = body.token;
  } catch {
    // ignore parse errors
  }
  if (!token) return c.json({ error: "Missing 2FA token" }, 400);

  const state = getUserTwoFactorState(user.id);
  if (!state?.enabled || !state.encryptedSecret) {
    return c.json({ error: "2FA is not enabled" }, 400);
  }

  const secret = await decryptTwoFactorSecret(state.encryptedSecret);
  if (!secret || !verifyTotpToken(secret, user.username, token)) {
    return c.json({ error: "Invalid 2FA token" }, 401);
  }

  disableUserTwoFactor(user.id);
  return c.json({ twoFactorEnabled: false });
});

// GET /users/permissions-schema — returns the valid resources and actions
adminRoutes.get("/users/permissions-schema", (c) => {
  const user = getAuthUser(c);
  const canViewSchema = !!user &&
    (user.isAdmin ||
      user.permissions.some(
        (p) =>
          p.resource === "users" &&
          (p.action === "read" ||
            p.action === "create" ||
            p.action === "update"),
      ));
  if (!canViewSchema) {
    return c.json(
      { error: "Missing permission: users:read|create|update" },
      403,
    );
  }

  return c.json({
    resources: RESOURCES,
    resourceActions: RESOURCE_ACTIONS,
  });
});

// GET /users — list all users
adminRoutes.get("/users", requirePermission("users", "read"), (c) => {
  const users = listUsers();
  return c.json(users);
});

// POST /users — create a new user
adminRoutes.post("/users", requirePermission("users", "create"), async (c) => {
  try {
    const data = await c.req.json();
    const user = await createUserCtrl(data);
    return c.json(user, 201);
  } catch (e) {
    const msg = String(e);
    if (/already exists/i.test(msg)) return c.json({ error: msg }, 409);
    return c.json({ error: msg }, 400);
  }
});

// GET /users/:id — get user details
adminRoutes.get("/users/:id", requirePermission("users", "read"), (c) => {
  const id = c.req.param("id");
  const user = getUserByIdCtrl(id);
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

// PUT /users/:id — update user
adminRoutes.put(
  "/users/:id",
  requirePermission("users", "update"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const data = await c.req.json();
      const currentUser = getAuthUser(c);

      // Prevent admin from demoting themselves
      if (currentUser.id === id && data.isAdmin === false) {
        return c.json({ error: "Cannot remove your own admin status" }, 400);
      }
      // Prevent admin from deactivating themselves
      if (currentUser.id === id && data.isActive === false) {
        return c.json({ error: "Cannot deactivate your own account" }, 400);
      }

      const user = await updateUserCtrl(id, data);
      return c.json(user);
    } catch (e) {
      const msg = String(e);
      if (/already exists/i.test(msg)) return c.json({ error: msg }, 409);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

// DELETE /users/:id — delete user
adminRoutes.delete("/users/:id", requirePermission("users", "delete"), (c) => {
  const id = c.req.param("id");
  try {
    deleteUserCtrl(id);
    return c.json({ success: true });
  } catch (e) {
    const msg = String(e);
    if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
    if (/last admin/i.test(msg)) return c.json({ error: msg }, 400);
    return c.json({ error: msg }, 400);
  }
});

export { adminRoutes };
