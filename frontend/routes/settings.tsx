import { Handlers, PageProps } from "$fresh/server.ts";
import { Layout } from "../components/Layout.tsx";
import InstallTemplateForm from "../islands/InstallTemplateForm.tsx";
import SettingsEnhancements from "../islands/SettingsEnhancements.tsx";
import SettingsNav from "../islands/SettingsNav.tsx";
import ThemeToggle from "../islands/ThemeToggle.tsx";
import ExportAll from "../islands/ExportAll.tsx";
import RateModifiersManager from "../islands/RateModifiersManager.tsx";
import {
  LuAlertTriangle,
  LuBuilding2,
  LuPalette,
  LuSun,
  LuLayoutTemplate,
  LuCreditCard,
  LuPercent,
  LuHash,
  LuFileCode2,
  LuDownload,
  LuSave,
  LuLanguages,
  LuSettings,
} from "../components/icons.tsx";
import {
  backendGet,
  backendPatch,
  backendDelete,
  backendPost,
  getAuthHeaderFromCookie,
} from "../utils/backend.ts";
import { useTranslations } from "../i18n/context.tsx";

type Settings = Record<string, unknown> & {
  companyName?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  embedXmlInHtml?: string;
  locale?: string;
};
type Template = { id: string; name: string; isDefault?: boolean; updatable?: boolean };
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
        backendGet("/api/v1/templates", auth).catch(() => []) as Promise<Template[]>,
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
    // Preserve the current tab by reading the section from the request URL
    const url = new URL(req.url);
    const sectionParam = url.searchParams.get("section") || "company";
    const form = await req.formData();
  const payload: Record<string, string> = {};
    // Handle delete template action early
    const deleteId = String(form.get("deleteTemplateId") ?? "").trim();
    if (deleteId) {
      try {
        await backendDelete(`/api/v1/templates/${deleteId}`, auth);
        return new Response(null, {
          status: 303,
          headers: { Location: `/settings?section=${encodeURIComponent(sectionParam)}` },
        });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    // Handle template update action
    const updateId = String(form.get("updateTemplateId") ?? "").trim();
    if (updateId) {
      try {
        await backendPost(`/api/v1/templates/${updateId}/update`, auth, {});
        return new Response(null, {
          status: 303,
          headers: { Location: `/settings?section=${encodeURIComponent(sectionParam || "templates")}` },
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
      // Date format
      "dateFormat",
      // Number format
      "numberFormat",
    ];
    // Collect values; handle duplicate hidden + checkbox pattern (want last value = actual state)
    for (const f of fields) {
      const all = form.getAll(f).map((v) => String(v));
      if (all.length === 0) continue;
      // Take the last value, even if empty (to allow clearing optional fields)
      const chosen = all[all.length - 1];
      payload[f] = chosen;
    }
    // Normalize boolean-style toggles to explicit "true"/"false" strings
    ["embedXmlInPdf", "embedXmlInHtml", "invoiceNumberingEnabled"].forEach((k) => {
      if (k in payload) {
        const v = String(payload[k]).toLowerCase();
        payload[k] = v === "true" ? "true" : "false";
      }
    });
    // Normalize aliases back to stored keys
    if ("email" in payload && !("companyEmail" in payload)) {
      payload.companyEmail = payload.email;
      delete payload.email;
    }
    if ("phone" in payload && !("companyPhone" in payload)) {
      payload.companyPhone = payload.phone;
      delete payload.phone;
    }
    if ("taxId" in payload && !("companyTaxId" in payload)) {
      payload.companyTaxId = payload.taxId;
      delete payload.taxId;
    }
    if ("countryCode" in payload && !("companyCountryCode" in payload)) {
      payload.companyCountryCode = payload.countryCode;
      delete payload.countryCode;
    }
    try {
      await backendPatch("/api/v1/settings", auth, payload);
      return new Response(null, {
        status: 303,
        headers: { Location: `/settings?section=${encodeURIComponent(sectionParam)}` },
      });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
};

export default function SettingsPage(props: PageProps<Data & { demoMode: boolean }>) {
  const { t } = useTranslations();
  const s = props.data.settings ?? {} as Settings;
  const templates = props.data.templates ?? [] as Template[];
  const selectedTemplateId = (s.templateId as string) ||
    (templates.find((t) => t.isDefault)?.id) ||
    "minimalist-clean";
  const xmlProfileId = (s.xmlProfileId as string) || 'ubl21';
  const embedXmlInPdf = String(s.embedXmlInPdf || 'false').toLowerCase() === 'true';
  const embedXmlInHtml = String(s.embedXmlInHtml || 'false').toLowerCase() === 'true';
  const currentLocale = (s.locale as string) || "en";
  const localeOptions = [
    { value: "en", labelKey: "English" },
    { value: "nl", labelKey: "Dutch" },
    { value: "de", labelKey: "German" },
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
    "localization",
    "templates",
    "payments",
    "tax",
    "rate-modifiers",
    "numbering",
    "xml",
    "export",
  ]);
  const section = allowed.has(sectionParam) ? sectionParam : "company";
  const hasTemplates = templates.length > 0;
  const link = (key: string) => `/settings?section=${encodeURIComponent(key)}`;
  return (
    <Layout authed={props.data.authed} demoMode={demoMode} path={new URL(props.url).pathname} wide>
      <SettingsEnhancements />
      
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-semibold">{t("Settings heading")}</h1>
      </div>

      {demoMode && (
        <div class="alert alert-warning mb-4">
          <LuAlertTriangle size={20} />
          <div>{t("Demo mode warning")}</div>
        </div>
      )}
      {props.data.error && (
        <div class="alert alert-error mb-4">
          <span>{props.data.error}</span>
        </div>
      )}
      
      {/* Mobile: Dropdown menu */}
      <div class="md:hidden mb-4">
        <SettingsNav 
          currentSection={link(section)}
          currentLabel={(() => {
            const labels: Record<string, string> = {
              company: t("Company"),
              branding: t("Branding"),
              appearance: t("Appearance"),
              localization: t("Localization"),
              templates: t("Templates"),
              payments: t("Payments"),
              tax: t("Tax"),
              "rate-modifiers": "Rate Modifiers",
              numbering: t("Numbering"),
              xml: t("XML Export"),
              export: t("Export"),
            };
            return labels[section] || labels.company;
          })()}
          sections={[
            { value: link("company"), label: t("Company"), icon: LuBuilding2 },
            { value: link("branding"), label: t("Branding"), icon: LuPalette },
            { value: link("appearance"), label: t("Appearance"), icon: LuSun },
            { value: link("localization"), label: t("Localization"), icon: LuLanguages },
            { value: link("templates"), label: t("Templates"), icon: LuLayoutTemplate, show: hasTemplates },
            { value: link("payments"), label: t("Payments"), icon: LuCreditCard },
            { value: link("tax"), label: t("Tax"), icon: LuPercent },
            { value: link("rate-modifiers"), label: "Rate Modifiers", icon: LuSettings },
            { value: link("numbering"), label: t("Numbering"), icon: LuHash },
            { value: link("xml"), label: t("XML Export"), icon: LuFileCode2 },
            { value: link("export"), label: t("Export"), icon: LuDownload },
          ]}
        />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
        {/* Desktop: Vertical sidebar menu */}
        <aside class="hidden md:block">
          <ul class="menu bg-base-200 rounded-box w-full">
            <li>
              <a href={link("company")} class={section === "company" ? "active" : undefined}>
                <LuBuilding2 size={20} class="mr-2" />
                {t("Company")}
              </a>
            </li>
            <li>
              <a href={link("branding")} class={section === "branding" ? "active" : undefined}>
                <LuPalette size={20} class="mr-2" />
                {t("Branding")}
              </a>
            </li>
            <li>
              <a href={link("appearance")} class={section === "appearance" ? "active" : undefined}>
                <LuSun size={20} class="mr-2" />
                {t("Appearance")}
              </a>
            </li>
            <li>
              <a href={link("localization")} class={section === "localization" ? "active" : undefined}>
                <LuLanguages size={20} class="mr-2" />
                {t("Localization")}
              </a>
            </li>
            {hasTemplates && (
              <li>
                <a href={link("templates")} class={section === "templates" ? "active" : undefined}>
                  <LuLayoutTemplate size={20} class="mr-2" />
                  {t("Templates")}
                </a>
              </li>
            )}
            <li>
              <a href={link("payments")} class={section === "payments" ? "active" : undefined}>
                <LuCreditCard size={20} class="mr-2" />
                {t("Payments")}
              </a>
            </li>
            <li>
              <a href={link("tax")} class={section === "tax" ? "active" : undefined}>
                <LuPercent size={20} class="mr-2" />
                {t("Tax")}
              </a>
            </li>
            <li>
              <a href={link("rate-modifiers")} class={section === "rate-modifiers" ? "active" : undefined}>
                <LuSettings size={20} class="mr-2" />
                Rate Modifiers
              </a>
            </li>
            <li>
              <a href={link("numbering")} class={section === "numbering" ? "active" : undefined}>
                <LuHash size={20} class="mr-2" />
                {t("Numbering")}
              </a>
            </li>
            <li>
              <a href={link("xml")} class={section === "xml" ? "active" : undefined}>
                <LuFileCode2 size={20} class="mr-2" />
                {t("XML Export")}
              </a>
            </li>
            <li>
              <a href={link("export")} class={section === "export" ? "active" : undefined}>
                <LuDownload size={20} class="mr-2" />
                {t("Export")}
              </a>
            </li>
          </ul>
        </aside>
        
        <section class="space-y-4">
          {section === "company" && (
            <form method="post" class="space-y-4" data-writable>
              <h2 class="text-xl font-semibold">{t("Company Information")}</h2>
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Company Name")}</span></div>
                  <input name="companyName" value={(s.companyName as string) || ""} class="input input-bordered w-full" data-writable />
                </label>
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Currency")}</span></div>
                  <input name="currency" value={(s.currency as string) || "USD"} class="input input-bordered w-full" data-writable />
                </label>
              </div>
              <label class="form-control">
                <div class="label"><span class="label-text">{t("Company Address")}</span></div>
                <textarea name="companyAddress" class="textarea textarea-bordered" rows={2} data-writable>{(s.companyAddress as string) || ""}</textarea>
              </label>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label class="form-control"><div class="label"><span class="label-text">{t("Email")}</span></div><input name="email" value={(s.email as string) || (s.companyEmail as string) || ""} class="input input-bordered w-full" data-writable /></label>
                <label class="form-control"><div class="label"><span class="label-text">{t("Phone")}</span></div><input name="phone" value={(s.phone as string) || (s.companyPhone as string) || ""} class="input input-bordered w-full" data-writable /></label>
                <label class="form-control"><div class="label"><span class="label-text">{t("Tax ID")}</span></div><input name="taxId" value={(s.taxId as string) || (s.companyTaxId as string) || ""} class="input input-bordered w-full" data-writable /></label>
                <label class="form-control"><div class="label"><span class="label-text">{t("Country Code (ISO alpha-2)")}</span></div><input name="countryCode" value={(s.countryCode as string) || (s.companyCountryCode as string) || ""} class="input input-bordered w-full" placeholder={t("Country code placeholder")} maxlength={2} data-writable /></label>
              </div>
              
              <div class="flex justify-end">
                <button type="submit" class="btn btn-primary" data-writable>
                  <LuSave size={16} />
                  {t("Save Changes")}
                </button>
              </div>
            </form>
          )}

          {section === "branding" && (
            <form method="post" class="space-y-4" data-writable>
              <h2 class="text-xl font-semibold">{t("Branding Settings")}</h2>
              
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Default Template")}</span></div>
                  <select name="templateId" class="select select-bordered w-full" value={selectedTemplateId}>
                    {templates.length > 0 ? (templates.map((template) => (<option value={template.id} key={template.id}>{template.name}</option>))) : (<><option value="professional-modern">{t("Professional Modern")}</option><option value="minimalist-clean">{t("Minimalist Clean")}</option></>)}
                  </select>
                </label>
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Highlight Color")}</span></div>
                  <div class="flex items-center gap-2">
                    <input id="highlight-input" name="highlight" value={(s.highlight as string) || "#6B4EFF"} class="input input-bordered w-full" placeholder="#6B4EFF" />
                    <span id="highlight-swatch" class="inline-block w-6 h-6 rounded" style={`background: ${(s.highlight as string) || "#6B4EFF"}`}></span>
                  </div>
                </label>
              </div>
              <div class="grid grid-cols-1 gap-3 mt-2">
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Logo")}</span></div>
                  <input id="logo-input" name="logo" value={(s.logo as string) || (s.logoUrl as string) || ""} class="input input-bordered w-full" placeholder={t("Logo placeholder")}
                  />
                </label>
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Upload Logo Image")}</span></div>
                  <input id="logo-file" type="file" accept="image/*,.svg" class="file-input file-input-bordered w-full" />
                  <div class="label"><span class="label-text-alt">{t("Select an image file to upload (PNG, JPG, SVG, etc.) - max 5MB")}</span></div>
                </label>
                <div class="flex items-center gap-3">
                  <span id="logo-error" class="text-error text-sm hidden">{t("Invalid logo URL or data URI")}</span>
                  <div id="logo-preview" class="hidden">
                    <img id="logo-preview-img" class="max-h-16 max-w-32 object-contain border rounded" alt={t("Logo preview alt")} />
                  </div>
                </div>
                <div id="color-suggestions" class="hidden">
                  <div class="label"><span class="label-text">{t("Suggested accent colors from logo:")}</span></div>
                  <div class="flex gap-2 mt-1"></div>
                </div>
              </div>
              
              <div class="flex justify-end">
                <button type="submit" class="btn btn-primary" data-writable>
                  <LuSave size={16} />
                  {t("Save Changes")}
                </button>
              </div>
            </form>
          )}

          {section === "appearance" && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold">{t("Appearance heading")}</h2>
              
              <div class="bg-base-200 rounded-box p-4">
                <h3 class="font-semibold mb-2">{t("Theme")}</h3>
                <div class="flex items-center gap-3">
                  <ThemeToggle size="md" label={t("Toggle light/dark theme")} />
                  <span class="text-sm opacity-70">{t("Switch between Light and Dark (DaisyUI)")}</span>
                </div>
              </div>
            </div>
          )}

          {section === "localization" && (
            <form method="post" class="space-y-4" data-writable>
              <h2 class="text-xl font-semibold">{t("Localization settings heading")}</h2>

              <div class="bg-base-200 rounded-box p-4">
                <h3 class="font-semibold mb-2">{t("Interface language heading")}</h3>
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Interface language label")}</span></div>
                  <select name="locale" class="select select-bordered w-full" value={currentLocale}>
                    {localeOptions.map((option) => (
                      <option value={option.value} key={option.value}>{t(option.labelKey)}</option>
                    ))}
                  </select>
                  <div class="label"><span class="label-text-alt">{t("Interface language helper")}</span></div>
                </label>
              </div>

              <div class="bg-base-200 rounded-box p-4">
                <h3 class="font-semibold mb-2">{t("Date Format")}</h3>
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Display dates as")}</span></div>
                  <select name="dateFormat" class="select select-bordered w-full" value={(s.dateFormat as string) || "YYYY-MM-DD"}>
                    <option value="YYYY-MM-DD">{t("YYYY-MM-DD (2025-01-15)")}</option>
                    <option value="DD.MM.YYYY">{t("DD.MM.YYYY (15.01.2025)")}</option>
                  </select>
                  <div class="label"><span class="label-text-alt">{t("Choose how dates are displayed in invoices")}</span></div>
                </label>
              </div>

              <div class="bg-base-200 rounded-box p-4">
                <h3 class="font-semibold mb-2">{t("Number Formatting")}</h3>
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Thousands separator")}</span></div>
                  <select
                    name="numberFormat"
                    class="select select-bordered w-full"
                    value={(s.numberFormat as string) || "comma"}
                  >
                    <option value="comma">{t("Comma (1,000.00)")}</option>
                    <option value="period">{t("Period (1.000,00)")}</option>
                  </select>
                  <div class="label"><span class="label-text-alt">{t("Controls currency formatting everywhere, including PDFs")}</span></div>
                </label>
              </div>

              <div class="flex justify-end">
                <button type="submit" class="btn btn-primary" data-writable>
                  <LuSave size={16} />
                  {t("Save Changes")}
                </button>
              </div>
            </form>
          )}

          {section === "templates" && hasTemplates && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold">{t("Templates")}</h2>
              
              <div class="flex items-center justify-between mb-3">
                <div class="text-sm opacity-70">{t("Manage your invoice templates")}</div>
                <InstallTemplateForm />
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {templates.map((template) => {
                  const builtIn = template.id === "professional-modern" || template.id === "minimalist-clean";
                  return (
                    <div class="card bg-base-200 shadow-sm" key={template.id}>
                      <div class="card-body p-3">
                        <div class="flex items-start justify-between">
                          <div>
                            <div class="font-medium">{template.name}</div>
                            <div class="text-xs opacity-60">{template.id}</div>
                          </div>
                          {selectedTemplateId === template.id && <span class="badge badge-primary">{t("Default")}</span>}
                        </div>
                        <div class="card-actions justify-end mt-2 gap-2">
                          {selectedTemplateId !== template.id && (
                            <form method="post" data-writable>
                              <input type="hidden" name="templateId" value={template.id} />
                              <button class="btn btn-sm" type="submit" data-writable>
                                {t("Set default")}
                              </button>
                            </form>
                          )}
                          {!builtIn && template.updatable && (
                            <form method="post" data-writable>
                              <input type="hidden" name="updateTemplateId" value={template.id} />
                              <button class="btn btn-sm" type="submit" data-writable>
                                {t("Update")}
                              </button>
                            </form>
                          )}
                          {!builtIn && selectedTemplateId !== template.id && (
                            <form method="post" data-writable>
                              <input type="hidden" name="deleteTemplateId" value={template.id} />
                              <button class="btn btn-sm btn-error" type="submit" data-writable>
                                {t("Delete")}
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p class="text-xs opacity-60 mt-2">{t("Built-in templates note")}</p>
            </div>
          )}

          {section === "payments" && (
            <form method="post" class="space-y-4" data-writable>
              <h2 class="text-xl font-semibold">{t("Payment Settings")}</h2>
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control"><div class="label"><span class="label-text">{t("Payment Methods")}</span></div><input name="paymentMethods" value={(s.paymentMethods as string) || t("Bank Transfer")}
                  class="input input-bordered w-full" data-writable /></label>
                <label class="form-control"><div class="label"><span class="label-text">{t("Bank Account")}</span></div><input name="bankAccount" value={(s.bankAccount as string) || ""} class="input input-bordered w-full" data-writable /></label>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control"><div class="label"><span class="label-text">{t("Payment Terms")}</span></div><input name="paymentTerms" value={(s.paymentTerms as string) || t("Due in 30 days")} class="input input-bordered w-full" data-writable /></label>
                <label class="form-control"><div class="label"><span class="label-text">{t("Default Notes")}</span></div><input name="defaultNotes" value={(s.defaultNotes as string) || ""} class="input input-bordered w-full" data-writable /></label>
              </div>
              
              <div class="flex justify-end">
                <button type="submit" class="btn btn-primary" data-writable>
                  <LuSave size={16} />
                  {t("Save Changes")}
                </button>
              </div>
            </form>
          )}

          {section === "tax" && (
            <form method="post" class="space-y-4" data-writable>
              <h2 class="text-xl font-semibold">{t("Tax Settings")}</h2>
              
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="form-control"><div class="label"><span class="label-text">{t("Default tax rate (%)")}</span></div><input type="number" step="0.01" min="0" name="defaultTaxRate" value={String((s.defaultTaxRate as number) ?? 0)} class="input input-bordered w-full" data-writable /></label>
                <label class="form-control"><div class="label"><span class="label-text">{t("Prices include tax?")}</span></div><select name="defaultPricesIncludeTax" class="select select-bordered w-full" value={(String(s.defaultPricesIncludeTax || "false").toLowerCase() === "true") ? "true" : "false"} data-writable><option value="false">{t("No")}</option><option value="true">{t("Yes")}</option></select></label>
                <label class="form-control"><div class="label"><span class="label-text">{t("Rounding mode")}</span></div><select name="defaultRoundingMode" class="select select-bordered w-full" value={(s.defaultRoundingMode as string) || 'line'} data-writable><option value="line">{t("Round per line")}</option><option value="total">{t("Round on totals")}</option></select></label>
              </div>
              
              <div class="flex justify-end">
                <button type="submit" class="btn btn-primary" data-writable>
                  <LuSave size={16} />
                  {t("Save Changes")}
                </button>
              </div>
            </form>
          )}

          {section === "rate-modifiers" && (
            <div class="space-y-4">
              <div>
                <h2 class="text-xl font-semibold mb-2">Rate Modifiers</h2>
                <p class="text-sm opacity-70">
                  Configure multipliers for different types of work (Standard, Holiday, Overnight, etc.). 
                  These will be available as options when creating invoices.
                </p>
              </div>
              <RateModifiersManager />
            </div>
          )}

          {section === "numbering" && (
            <form method="post" class="space-y-4" data-writable>
              <h2 class="text-xl font-semibold">{t("Invoice Numbering")}</h2>
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Enable advanced numbering pattern")}</span></div>
                  <div class="flex items-center gap-3">
                    {/* Hidden field ensures a value is sent when unchecked */}
                    <input type="hidden" name="invoiceNumberingEnabled" value="false" />
                    <input type="checkbox" name="invoiceNumberingEnabled" value="true" class="toggle toggle-primary" checked={String((s.invoiceNumberingEnabled as string) ?? 'true').toLowerCase() !== 'false'} />
                    <span class="text-sm opacity-70">{t("Invoice numbering toggle helper")}</span>
                  </div>
                </label>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="form-control">
                  <div class="label"><span class="label-text">{t("Invoice Number Pattern")}</span></div>
                  <input name="invoiceNumberPattern" value={(s.invoiceNumberPattern as string) || ''} class="input input-bordered w-full" placeholder={t("Invoice number pattern placeholder")} />
                </label>
              </div>
              <p class="text-xs mt-2 opacity-70">{t("Invoice numbering tokens help")}</p>
              
              <div class="flex justify-end">
                <button type="submit" class="btn btn-primary" data-writable>
                  <LuSave size={16} />
                  {t("Save Changes")}
                </button>
              </div>
            </form>
          )}

          {section === "xml" && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold">{t("XML Export Settings")}</h2>
              
              <form method="post" data-writable>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label class="form-control">
                    <div class="label"><span class="label-text">{t("Default XML Profile")}</span></div>
                    <select name="xmlProfileId" class="select select-bordered w-full" value={xmlProfileId}>
                      <option value="ubl21">{t("UBL 2.1 (PEPPOL BIS)")}</option>
                      <option value="facturx22">{t("Factur-X / ZUGFeRD 2.2 (BASIC)")}</option>
                      <option value="fatturapa">{t("FatturaPA 1.9")}</option>
                    </select>
                  </label>
                  <label class="form-control">
                    <div class="label flex justify-between"><span class="label-text">{t("Embed XML in PDF")}</span></div>
                    <div class="flex items-center gap-3 mt-1">
                      <input type="hidden" name="embedXmlInPdf" value="false" />
                      <input type="checkbox" name="embedXmlInPdf" value="true" class="toggle toggle-primary" checked={embedXmlInPdf} />
                      <span class="text-xs opacity-70">{t("Adds selected XML as a PDF attachment")}</span>
                    </div>
                  </label>
                  <label class="form-control">
                    <div class="label flex justify-between"><span class="label-text">{t("Embed XML in HTML")}</span></div>
                    <div class="flex items-center gap-3 mt-1">
                      <input type="hidden" name="embedXmlInHtml" value="false" />
                      <input type="checkbox" name="embedXmlInHtml" value="true" class="toggle toggle-primary" checked={embedXmlInHtml} />
                      <span class="text-xs opacity-70">{t("Adds selected XML as an HTML attachment")}</span>
                    </div>
                  </label>
                </div>
                
                <div class="flex justify-end">
                  <button type="submit" class="btn btn-primary" data-writable>
                    <LuSave size={16} />
                    {t("Save Changes")}
                  </button>
                </div>
              </form>
              
              <div class="bg-base-200 rounded-box p-3">
                <p class="text-xs opacity-70">{t("XML profiles helper")}</p>
              </div>
            </div>
          )}

          {section === "export" && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold">{t("Export data heading")}</h2>
              <ExportAll />
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
