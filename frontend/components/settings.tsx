import { PageProps } from "fresh";
import { Layout } from "../components/Layout.tsx";
import InstallTemplateForm from "../islands/InstallTemplateForm.tsx";
import SettingsEnhancements from "../islands/SettingsEnhancements.tsx";
import ThemeToggle from "../islands/ThemeToggle.tsx";
import ExportAll from "../islands/ExportAll.tsx";
import {
  LuBuilding2,
  LuCreditCard,
  LuDownload,
  LuFileCode2,
  LuHash,
  LuLayoutTemplate,
  LuPalette,
  LuPercent,
  LuSun,
} from "../components/icons.tsx";
import {
  backendDelete,
  backendGet,
  backendPatch,
  getAuthHeaderFromCookie,
} from "../utils/backend.ts";
import { Handlers } from "fresh/compat";

type Settings = Record<string, unknown> & {
  companyName?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  embedXmlInHtml?: string;
  locale?: string;
};
type Template = { id: string; name: string; isDefault?: boolean };
type Data = {
  authed: boolean;
  settings?: Settings;
  templates?: Template[];
  error?: string;
};

export const handler: Handlers<Data & { demoMode: boolean }> = {
  async GET(req, ctx) {
    const auth = getAuthHeaderFromCookie(
      req.headers.get("cookie") || undefined,
    );
    if (!auth) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/login" },
      });
    }
    try {
      // Fetch demo mode from public endpoint (no auth)
      const demoModePromise = fetch("/api/public/demo-mode").then(async (r) => {
        if (!r.ok) return false;
        const data = await r.json();
        return !!data.demoMode;
      }).catch(() => false);
      const [settings, templates, demoMode] = await Promise.all([
        backendGet("/api/v1/settings", auth) as Promise<Settings>,
        backendGet("/api/v1/templates", auth).catch(() => []) as Promise<
          Template[]
        >,
        demoModePromise,
      ]);
      return ctx.render({ authed: true, settings, templates, demoMode });
    } catch (e) {
      // Try to still get demoMode if possible
      let demoMode = false;
      try {
        const r = await fetch("/api/public/demo-mode");
        if (r.ok) {
          const data = await r.json();
          demoMode = !!data.demoMode;
        }
      } catch { /* ignore */ }
      return ctx.render({ authed: true, error: String(e), demoMode });
    }
  },
  async POST(req) {
    const auth = getAuthHeaderFromCookie(
      req.headers.get("cookie") || undefined,
    );
    if (!auth) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/login" },
      });
    }
    const form = await req.formData();
    const payload: Record<string, string> = {};
    // Handle delete template action early
    const deleteId = String(form.get("deleteTemplateId") ?? "").trim();
    if (deleteId) {
      try {
        await backendDelete(`/api/v1/templates/${deleteId}`, auth);
        return new Response(null, {
          status: 303,
          headers: { Location: "/settings" },
        });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }

    const fields = [
      "companyName",
      "companyAddress",
      "email",
      "phone",
      "taxId",
      "countryCode",
      "currency",
      "locale",
      "paymentMethods",
      "bankAccount",
      "paymentTerms",
      "defaultNotes",
      "templateId",
      "highlight",
      "logo",
      // XML export
      "xmlProfileId",
      "embedXmlInPdf",
      "embedXmlInHtml",
      // Defaults for taxes
      "defaultTaxRate",
      "defaultPricesIncludeTax",
      "defaultRoundingMode",
      // Numbering pattern
      "invoiceNumberPattern",
      // Toggle to enable/disable advanced invoice numbering pattern
      "invoiceNumberingEnabled",
    ];
    // Collect values; handle duplicate hidden + checkbox pattern (want last value = actual state)
    for (const f of fields) {
      const all = form.getAll(f).map((v) => String(v));
      if (all.length === 0) continue;
      // Take the last non-empty value (e.g., hidden "false" then checkbox "true")
      let chosen = "";
      for (let i = all.length - 1; i >= 0; i--) {
        if (all[i] !== "") {
          chosen = all[i];
          break;
        }
      }
      if (chosen !== "") payload[f] = chosen;
    }
    // Normalize boolean-style toggles to explicit "true"/"false" strings
    ["embedXmlInPdf", "embedXmlInHtml", "invoiceNumberingEnabled"].forEach(
      (k) => {
        if (k in payload) {
          const v = String(payload[k]).toLowerCase();
          payload[k] = v === "true" ? "true" : "false";
        }
      },
    );
    // Normalize aliases back to stored keys
    if (payload.email && !payload.companyEmail) {
      payload.companyEmail = payload.email;
      delete payload.email;
    }
    if (payload.phone && !payload.companyPhone) {
      payload.companyPhone = payload.phone;
      delete payload.phone;
    }
    if (payload.taxId && !payload.companyTaxId) {
      payload.companyTaxId = payload.taxId;
      delete payload.taxId;
    }
    if (payload.countryCode && !payload.companyCountryCode) {
      payload.companyCountryCode = payload.countryCode;
      delete payload.countryCode;
    }
    try {
      await backendPatch("/api/v1/settings", auth, payload);
      return new Response(null, {
        status: 303,
        headers: { Location: "/settings" },
      });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
};

export default function SettingsPage(
  props: PageProps<Data & { demoMode: boolean }>,
) {
  const s = props.data.settings ?? {} as Settings;
  const templates = props.data.templates ?? [] as Template[];
  const selectedTemplateId = (s.templateId as string) ||
    (templates.find((t) => t.isDefault)?.id) ||
    "minimalist-clean";
  const xmlProfileId = (s.xmlProfileId as string) || "ubl21";
  const embedXmlInPdf =
    String(s.embedXmlInPdf || "false").toLowerCase() === "true";
  const embedXmlInHtml =
    String(s.embedXmlInHtml || "false").toLowerCase() === "true";
  const currentLocale = (s.locale as string) || "en";
  const localeOptions = [
    { value: "en", label: "English" },
    { value: "nl", label: "Nederlands" },
    { value: "de", label: "Deutsch" },
  ];
  // Use demoMode from backend /demo-mode route
  const demoMode = props.data.demoMode;
  // Determine current section from query param
  const url = new URL(props.url);
  const sectionParam = url.searchParams.get("section") || "company";
  const allowed = new Set([
    "company",
    "branding",
    "appearance",
    "templates",
    "payments",
    "tax",
    "numbering",
    "xml",
    "export",
  ]);
  const section = allowed.has(sectionParam) ? sectionParam : "company";
  const hasTemplates = templates.length > 0;
  const link = (key: string) => `/settings?section=${encodeURIComponent(key)}`;
  return (
    <Layout
      authed={props.data.authed}
      demoMode={demoMode}
      path={new URL(props.url).pathname}
    >
      <SettingsEnhancements />
      <h1 class="text-2xl font-semibold mb-4">Settings</h1>
      {demoMode && (
        <div class="alert alert-warning mb-4">
          Demo mode: the app is still fully functional, however the database of
          this hosted instance resets every 30 minutes, your changes are not
          permanent.
        </div>
      )}
      {props.data.error && (
        <div class="alert alert-error mb-3">
          <span>{props.data.error}</span>
        </div>
      )}
      <div class="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
        <aside>
          <ul class="menu bg-base-200 rounded-box w-full">
            <li>
              <a
                href={link("company")}
                class={section === "company" ? "active" : undefined}
              >
                <LuBuilding2 size={20} class="mr-2" />
                Company
              </a>
            </li>
            <li>
              <a
                href={link("branding")}
                class={section === "branding" ? "active" : undefined}
              >
                <LuPalette size={20} class="mr-2" />
                Branding
              </a>
            </li>
            <li>
              <a
                href={link("appearance")}
                class={section === "appearance" ? "active" : undefined}
              >
                <LuSun size={20} class="mr-2" />
                Appearance
              </a>
            </li>
            {hasTemplates && (
              <li>
                <a
                  href={link("templates")}
                  class={section === "templates" ? "active" : undefined}
                >
                  <LuLayoutTemplate size={20} class="mr-2" />
                  Templates
                </a>
              </li>
            )}
            <li>
              <a
                href={link("payments")}
                class={section === "payments" ? "active" : undefined}
              >
                <LuCreditCard size={20} class="mr-2" />
                Payments
              </a>
            </li>
            <li>
              <a
                href={link("tax")}
                class={section === "tax" ? "active" : undefined}
              >
                <LuPercent size={20} class="mr-2" />
                Tax
              </a>
            </li>
            <li>
              <a
                href={link("numbering")}
                class={section === "numbering" ? "active" : undefined}
              >
                <LuHash size={20} class="mr-2" />
                Numbering
              </a>
            </li>
            <li>
              <a
                href={link("xml")}
                class={section === "xml" ? "active" : undefined}
              >
                <LuFileCode2 size={20} class="mr-2" />
                XML Export
              </a>
            </li>
            <li>
              <a
                href={link("export")}
                class={section === "export" ? "active" : undefined}
              >
                <LuDownload size={20} class="mr-2" />
                Export
              </a>
            </li>
          </ul>
        </aside>
        <section class="bg-base-100 border-base-300 rounded-box p-4">
          {section === "company" && (
            <form method="post" data-writable>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Company Name</span>
                  </div>
                  <input
                    name="companyName"
                    value={(s.companyName as string) || ""}
                    class="input input-bordered w-full"
                    data-writable
                  />
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Currency</span>
                  </div>
                  <input
                    name="currency"
                    value={(s.currency as string) || "USD"}
                    class="input input-bordered w-full"
                    data-writable
                  />
                </label>
              </div>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">Company Address</span>
                </div>
                <textarea
                  name="companyAddress"
                  class="textarea textarea-bordered"
                  rows={2}
                  data-writable
                >
                  {(s.companyAddress as string) || ""}
                </textarea>
              </label>
              <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Email</span>
                  </div>
                  <input
                    name="email"
                    value={(s.email as string) || (s.companyEmail as string) ||
                      ""}
                    class="input input-bordered w-full"
                    data-writable
                  />
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Phone</span>
                  </div>
                  <input
                    name="phone"
                    value={(s.phone as string) || (s.companyPhone as string) ||
                      ""}
                    class="input input-bordered w-full"
                    data-writable
                  />
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Tax ID</span>
                  </div>
                  <input
                    name="taxId"
                    value={(s.taxId as string) || (s.companyTaxId as string) ||
                      ""}
                    class="input input-bordered w-full"
                    data-writable
                  />
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Country Code (ISO alpha-2)</span>
                  </div>
                  <input
                    name="countryCode"
                    value={(s.countryCode as string) ||
                      (s.companyCountryCode as string) || ""}
                    class="input input-bordered w-full"
                    placeholder="e.g. US, NL, DE"
                    maxlength={2}
                    data-writable
                  />
                </label>
              </div>
              <div class="pt-2">
                <button type="submit" class="btn btn-primary">Save</button>
              </div>
            </form>
          )}

          {section === "branding" && (
            <form method="post" data-writable>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Default Template</span>
                  </div>
                  <select
                    name="templateId"
                    class="select select-bordered w-full"
                    value={selectedTemplateId}
                  >
                    {templates.length > 0
                      ? (templates.map((t) => (
                        <option value={t.id} key={t.id}>{t.name}</option>
                      )))
                      : (
                        <>
                          <option value="professional-modern">
                            Professional Modern
                          </option>
                          <option value="minimalist-clean">
                            Minimalist Clean
                          </option>
                        </>
                      )}
                  </select>
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Highlight Color</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      id="highlight-input"
                      name="highlight"
                      value={(s.highlight as string) || "#6B4EFF"}
                      class="input input-bordered w-full"
                      placeholder="#6B4EFF"
                    />
                    <span
                      id="highlight-swatch"
                      class="inline-block w-6 h-6 rounded"
                      style={`background: ${
                        (s.highlight as string) || "#6B4EFF"
                      }`}
                    >
                    </span>
                  </div>
                </label>
              </div>
              <div class="grid grid-cols-1 gap-3 mt-2">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Logo</span>
                  </div>
                  <input
                    id="logo-input"
                    name="logo"
                    value={(s.logo as string) || (s.logoUrl as string) || ""}
                    class="input input-bordered w-full"
                    placeholder="https://example.com/logo.png or data:image/png;base64,..."
                  />
                </label>
                <div class="flex items-center gap-3">
                  <span id="logo-error" class="text-error text-sm hidden">
                    Invalid logo URL or data URI
                  </span>
                </div>
              </div>
              <div class="pt-2">
                <button type="submit" class="btn btn-primary">Save</button>
              </div>
            </form>
          )}

          {section === "appearance" && (
            <div class="grid gap-3">
              <div class="card bg-base-100 border-base-300">
                <div class="card-body p-4">
                  <h2 class="card-title mb-2">Theme</h2>
                  <div class="flex items-center gap-3">
                    <ThemeToggle size="md" label="Toggle light/dark theme" />
                    <span class="text-sm opacity-70">
                      Switch between Light and Dark (DaisyUI)
                    </span>
                  </div>
                </div>
              </div>
              <form method="post" data-writable>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label class="form-control">
                    <div class="label">
                      <span class="label-text">Thousands Separator</span>
                    </div>
                    <select
                      name="numberFormat"
                      class="select select-bordered w-full"
                      value={(s.numberFormat as string) || "comma"}
                    >
                      <option value="comma">Comma (1,000.00)</option>
                      <option value="period">Period (1.000,00)</option>
                    </select>
                  </label>
                  <label class="form-control">
                    <div class="label">
                      <span class="label-text">Date Format</span>
                    </div>
                    <select
                      name="dateFormat"
                      class="select select-bordered w-full"
                      value={(s.dateFormat as string) || "YYYY-MM-DD"}
                    >
                      <option value="YYYY-MM-DD">
                        YYYY-MM-DD (2025-01-15)
                      </option>
                      <option value="DD.MM.YYYY">
                        DD.MM.YYYY (15.01.2025)
                      </option>
                    </select>
                    <div class="label">
                      <span class="label-text-alt">
                        Choose how dates are displayed in invoices
                      </span>
                    </div>
                  </label>
                  <label class="form-control">
                    <div class="label">
                      <span class="label-text">Invoice Language</span>
                    </div>
                    <select
                      name="locale"
                      class="select select-bordered w-full"
                      value={currentLocale}
                    >
                      {localeOptions.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div class="label">
                      <span class="label-text-alt">
                        Applies to invoice labels and headings
                      </span>
                    </div>
                  </label>
                </div>
                <div class="pt-2">
                  <button type="submit" class="btn btn-primary">Save</button>
                </div>
              </form>
            </div>
          )}

          {section === "templates" && hasTemplates && (
            <div>
              <div class="flex items-center justify-between mb-2">
                <h2 class="card-title">Templates</h2>
                <InstallTemplateForm />
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                {templates.map((t) => (
                  <div
                    class="flex items-center justify-between p-2 border rounded-box"
                    key={t.id}
                  >
                    <div>
                      <div class="font-medium">{t.name}</div>
                      <div class="text-xs opacity-60">{t.id}</div>
                    </div>
                    <div class="flex items-center gap-2">
                      {selectedTemplateId === t.id
                        ? <span class="badge badge-primary">Default</span>
                        : (
                          <form method="post" data-writable>
                            <input
                              type="hidden"
                              name="templateId"
                              value={t.id}
                            />
                            <button
                              class="btn btn-sm"
                              type="submit"
                              disabled={demoMode}
                              data-writable
                            >
                              Set as default
                            </button>
                          </form>
                        )}
                      {t.id !== "professional-modern" &&
                        t.id !== "minimalist-clean" &&
                        selectedTemplateId !== t.id && (
                        <form method="post" data-writable>
                          <input
                            type="hidden"
                            name="deleteTemplateId"
                            value={t.id}
                          />
                          <button
                            class="btn btn-sm btn-error"
                            type="submit"
                            disabled={demoMode}
                            data-writable
                          >
                            Delete
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p class="text-xs opacity-60">
                Built-in templates are protected and cannot be deleted.
              </p>
            </div>
          )}

          {section === "payments" && (
            <form method="post" data-writable>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Payment Methods</span>
                  </div>
                  <input
                    name="paymentMethods"
                    value={(s.paymentMethods as string) || "Bank Transfer"}
                    class="input input-bordered w-full"
                  />
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Bank Account</span>
                  </div>
                  <input
                    name="bankAccount"
                    value={(s.bankAccount as string) || ""}
                    class="input input-bordered w-full"
                  />
                </label>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Payment Terms</span>
                  </div>
                  <input
                    name="paymentTerms"
                    value={(s.paymentTerms as string) || "Due in 30 days"}
                    class="input input-bordered w-full"
                  />
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Default Notes</span>
                  </div>
                  <input
                    name="defaultNotes"
                    value={(s.defaultNotes as string) || ""}
                    class="input input-bordered w-full"
                  />
                </label>
              </div>
              <div class="pt-2">
                <button type="submit" class="btn btn-primary">Save</button>
              </div>
            </form>
          )}

          {section === "tax" && (
            <form method="post" data-writable>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Default tax rate (%)</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="defaultTaxRate"
                    value={String((s.defaultTaxRate as number) ?? 0)}
                    class="input input-bordered w-full"
                    data-writable
                    disabled={demoMode}
                  />
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Prices include tax?</span>
                  </div>
                  <select
                    name="defaultPricesIncludeTax"
                    class="select select-bordered w-full"
                    value={(String(s.defaultPricesIncludeTax || "false")
                        .toLowerCase() === "true")
                      ? "true"
                      : "false"}
                    disabled={demoMode}
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </label>
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Rounding mode</span>
                  </div>
                  <select
                    name="defaultRoundingMode"
                    class="select select-bordered w-full"
                    value={(s.defaultRoundingMode as string) || "line"}
                    disabled={demoMode}
                  >
                    <option value="line">Round per line</option>
                    <option value="total">Round on totals</option>
                  </select>
                </label>
              </div>
              <div class="pt-2">
                <button type="submit" class="btn btn-primary">Save</button>
              </div>
            </form>
          )}

          {section === "numbering" && (
            <form method="post" data-writable>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">
                      Enable advanced numbering pattern
                    </span>
                  </div>
                  <div class="flex items-center gap-3">
                    {/* Hidden field ensures a value is sent when unchecked */}
                    <input
                      type="hidden"
                      name="invoiceNumberingEnabled"
                      value="false"
                    />
                    <input
                      type="checkbox"
                      name="invoiceNumberingEnabled"
                      value="true"
                      class="toggle toggle-primary"
                      checked={String(
                        (s.invoiceNumberingEnabled as string) ?? "true",
                      ).toLowerCase() !== "false"}
                    />
                    <span class="text-sm opacity-70">
                      When off, the invoice number pattern will be ignored and
                      legacy numbering will be used.
                    </span>
                  </div>
                </label>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control">
                  <div class="label">
                    <span class="label-text">Invoice Number Pattern</span>
                  </div>
                  <input
                    name="invoiceNumberPattern"
                    value={(s.invoiceNumberPattern as string) || ""}
                    class="input input-bordered w-full"
                    placeholder="e.g. INV-{YYYY}-{SEQ} or {YYYY}{MM}{SEQ}"
                  />
                </label>
              </div>
              <p class="text-xs mt-2 opacity-70">
                Tokens: {`{YYYY}`} full year, {`{YY}`} short year, {`{MM}`}{" "}
                month (01-12), {`{DD}`} day, {`{DATE}`} = {`{YYYY}{MM}{DD}`},
                {" "}
                {`{RAND4}`} random alnum 4 chars, {`{SEQ}`}{" "}
                auto-incrementing sequence (resets yearly when pattern includes
                {" "}
                {`{YYYY}`}{" "}
                ). Leave blank to use legacy prefix/year/padding settings.
              </p>
              <div class="pt-2">
                <button type="submit" class="btn btn-primary">Save</button>
              </div>
            </form>
          )}

          {section === "xml" && (
            <div>
              <form method="post" data-writable>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label class="form-control">
                    <div class="label">
                      <span class="label-text">Default XML Profile</span>
                    </div>
                    <select
                      name="xmlProfileId"
                      class="select select-bordered w-full"
                      value={xmlProfileId}
                    >
                      <option value="ubl21">UBL 2.1 (PEPPOL BIS)</option>
                      <option value="facturx22">Factur‑X / ZUGFeRD 2.2</option>
                      <option value="stub-generic">
                        Generic Stub (experimental)
                      </option>
                    </select>
                  </label>
                  <label class="form-control">
                    <div class="label flex justify-between">
                      <span class="label-text">Embed XML in PDF</span>
                    </div>
                    <div class="flex items-center gap-3 mt-1">
                      <input type="hidden" name="embedXmlInPdf" value="false" />
                      <input
                        type="checkbox"
                        name="embedXmlInPdf"
                        value="true"
                        class="toggle toggle-primary"
                        checked={embedXmlInPdf}
                      />
                      <span class="text-xs opacity-70">
                        Adds selected XML as a PDF attachment
                      </span>
                    </div>
                  </label>
                  <label class="form-control">
                    <div class="label flex justify-between">
                      <span class="label-text">Embed XML in HTML</span>
                    </div>
                    <div class="flex items-center gap-3 mt-1">
                      <input
                        type="hidden"
                        name="embedXmlInHtml"
                        value="false"
                      />
                      <input
                        type="checkbox"
                        name="embedXmlInHtml"
                        value="true"
                        class="toggle toggle-primary"
                        checked={embedXmlInHtml}
                      />
                      <span class="text-xs opacity-70">
                        Adds selected XML as an HTML attachment
                      </span>
                    </div>
                  </label>
                </div>
                <div class="pt-2">
                  <button type="submit" class="btn btn-primary">Save</button>
                </div>
              </form>
              <p class="text-xs mt-3 opacity-70">
                Profiles are currently built-in only. UBL 2.1 is the default and
                preferred for e-invoicing networks (PEPPOL). The stub profile is
                for internal testing.
              </p>
            </div>
          )}

          {section === "export" && <ExportAll />}
        </section>
      </div>
    </Layout>
  );
}
