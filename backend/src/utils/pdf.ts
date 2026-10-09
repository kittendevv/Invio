import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";
import { generateInvoiceXML, XMLProfile } from "./xmlProfiles.ts";
import { generateZugferdXMP } from "./xmp.ts";
import { join } from "std/path";
import {
  BusinessSettings,
  InvoiceWithDetails,
  TemplateContext,
} from "../types/index.ts";
import {
  contentTypeFromLogoPath,
  normalizeStoredLogoReference,
  resolveLogoFsPathFromPublicPath,
} from "./logoStorage.ts";
import {
  getTemplateById,
  renderTemplate as renderTpl,
} from "../controllers/templates.ts";
import { getDefaultTemplate } from "../controllers/templates.ts";
import { getInvoiceLabels } from "../i18n/translations.ts";
// pdf-lib is used to embed XML attachments and tweak metadata after rendering

// ---- Basic color helpers ----
function normalizeHex(hex?: string): string | undefined {
  if (!hex) return undefined;
  const h = hex.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(h)) return h.startsWith("#") ? h : `#${h}`;
  return undefined;
}

function escapeHtml(value: unknown): string {
  const str = value === undefined || value === null ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _escapeHtmlWithBreaks(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

const CITY_FIRST_POSTAL_COUNTRIES = new Set([
  "US",
  "GB",
  "BR",
  "AU",
  "CA",
  "NZ",
  "IE",
  "MX",
]);

type PostalCityFormat = "auto" | "city-postal" | "postal-city";

function normalizePostalCityFormat(value?: string): PostalCityFormat {
  if (value === "city-postal" || value === "postal-city") return value;
  return "auto";
}

function formatPostalCityLine(
  postalCode?: string,
  city?: string,
  countryCode?: string,
  format?: string,
): string | undefined {
  const postal = (postalCode || "").trim();
  const place = (city || "").trim();
  if (!postal && !place) return undefined;
  if (!postal) return place;
  if (!place) return postal;

  const normalizedFormat = normalizePostalCityFormat(format);
  if (normalizedFormat === "city-postal") {
    // City + Postal formats frequently expect a comma for readable locality. Example: Boston, 02110
    return `${place}, ${postal}`;
  }
  if (normalizedFormat === "postal-city") {
    return `${postal} ${place}`;
  }

  const country = (countryCode || "").trim().toUpperCase();
  if (CITY_FIRST_POSTAL_COUNTRIES.has(country)) {
    return `${place} ${postal}`;
  }
  return `${postal} ${place}`;
}

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isPrivateIPv4Host(hostname: string): boolean {
  const parts = hostname.split(".").map((n) => Number(n));
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6Host(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fd") || lower.startsWith("fc")) return true;
  if (lower.startsWith("fe80")) return true;
  return false;
}

function tryParseSafeRemoteUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return null;
  if (isPrivateIPv4Host(host) || isPrivateIPv6Host(host)) return null;
  return url;
}

function lighten(hex: string, amount = 0.85): string {
  const n = normalizeHex(hex) ?? "#2563eb";
  const m = n.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const rr = mix(r).toString(16).padStart(2, "0");
  const gg = mix(g).toString(16).padStart(2, "0");
  const bb = mix(b).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}

function formatDate(d?: Date, format: string = "YYYY-MM-DD") {
  if (!d) return undefined;
  const date = new Date(d);
  // Issue/due dates are stored as UTC midnight; read UTC parts so the
  // server's timezone can't shift them by a day.
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (format === "DD.MM.YYYY") {
    return `${day}.${month}.${year}`;
  }
  // Default to YYYY-MM-DD
  return `${year}-${month}-${day}`;
}

// Support a single stored 'logo' setting; 'logoUrl' here is a derived, inlined data URL for rendering robustness
type WithLogo = BusinessSettings & {
  logo?: string;
  logoUrl?: string;
  brandLayout?: string;
};

function normalizeLogoUrlForRender(
  logo?: string,
  forceAbsolute = false,
): string | undefined {
  if (!logo) return undefined;
  const value = normalizeStoredLogoReference(logo.trim());
  if (!value) return undefined;
  if (value.startsWith("data:")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) {
    if (forceAbsolute) {
      const fsPath = resolveLogoFsPathFromPublicPath(value);
      if (fsPath) {
        const normalized = fsPath.replaceAll("\\", "/").replace(/^\/*/, "/");
        return `file://${normalized}`;
      }
    }
    if (!forceAbsolute) return value;
    const base = Deno.env.get("BASE_URL") || "http://localhost:3000";
    try {
      return new URL(value, base).toString();
    } catch {
      return value;
    }
  }
  return value;
}

function formatMoney(
  value: number,
  currency: string,
  numberFormat: "comma" | "period" = "comma",
): string {
  // Create a custom locale based on the number format preference
  let locale: string;
  let options: Intl.NumberFormatOptions;

  if (numberFormat === "period") {
    // European style: 1.000,00
    locale = "de-DE"; // German locale uses period as thousands separator and comma as decimal
    options = { style: "currency", currency };
  } else {
    // US style: 1,000.00
    locale = "en-US";
    options = { style: "currency", currency };
  }

  return new Intl.NumberFormat(locale, options).format(value);
}

async function _inlineLogoIfPossible(
  settings?: BusinessSettings,
): Promise<BusinessSettings | undefined> {
  if (!settings?.logo) return settings;
  const url = settings.logo.trim();
  if (url.startsWith("data:")) {
    return { ...settings, logoUrl: url } as unknown as BusinessSettings;
  }

  const toDataUrl = (bytes: Uint8Array, mime = "image/png") => {
    const base64 = btoa(String.fromCharCode(...bytes));
    return `data:${mime};base64,${base64}`;
  };

  try {
    if (url.startsWith("/") && resolveLogoFsPathFromPublicPath(url)) {
      const fsPath = resolveLogoFsPathFromPublicPath(url);
      if (fsPath) {
        const file = await Deno.readFile(fsPath);
        return {
          ...settings,
          logoUrl: toDataUrl(file, contentTypeFromLogoPath(fsPath)),
        } as unknown as BusinessSettings;
      }
    }

    const remote = tryParseSafeRemoteUrl(url);
    if (remote) {
      const res = await fetch(remote);
      if (!res.ok) return settings;
      const buf = new Uint8Array(await res.arrayBuffer());
      const mime = res.headers.get("content-type") ?? "image/png";
      return {
        ...settings,
        logoUrl: toDataUrl(buf, mime),
      } as unknown as BusinessSettings;
    }
    // Attempt local file read (prevent traversal)
    if (url.includes("..")) {
      return settings;
    }
    const file = await Deno.readFile(url);
    let mime = "image/png";
    if (url.endsWith(".jpg") || url.endsWith(".jpeg")) mime = "image/jpeg";
    if (url.endsWith(".svg")) mime = "image/svg+xml";
    return {
      ...settings,
      logoUrl: toDataUrl(file, mime),
    } as unknown as BusinessSettings;
  } catch (_e) {
    return settings; // keep original
  }
}

function buildContext(
  invoice: InvoiceWithDetails,
  settings?: BusinessSettings & { logoUrl?: string; brandLayout?: string },
  _highlight?: string,
  dateFormat?: string,
  numberFormat?: "comma" | "period",
  localeOverride?: string,
  forceAbsoluteLogoUrl = false,
): TemplateContext & { logoUrl?: string; brandLogoLeft?: boolean } {
  const requestedLocale = localeOverride ?? invoice.locale ?? settings?.locale;
  const { locale: resolvedLocale, labels } = getInvoiceLabels(requestedLocale);
  const currency = invoice.currency || settings?.currency || "USD";
  const companyPostalCity = formatPostalCityLine(
    settings?.companyPostalCode,
    settings?.companyCity,
    settings?.companyCountryCode,
    settings?.postalCityFormat,
  );
  const taxLabel = settings?.taxLabel && String(settings.taxLabel).trim()
    ? String(settings.taxLabel).trim()
    : labels.taxLabel;
  // Build tax summary from normalized taxes if present
  let taxSummary = invoice.taxes && invoice.taxes.length > 0
    ? invoice.taxes.map((t) => ({
      label: `${taxLabel} ${t.percent}%`,
      percent: t.percent,
      taxable: formatMoney(
        t.taxableAmount,
        currency,
        numberFormat || "comma",
      ),
      amount: formatMoney(t.taxAmount, currency, numberFormat || "comma"),
    }))
    : undefined;
  // Fallback: synthesize a single-row summary from invoice-level taxRate
  if ((!taxSummary || taxSummary.length === 0) && invoice.taxAmount > 0) {
    const percent = invoice.taxRate || 0;
    const taxableBase = Math.max(
      0,
      (invoice.subtotal || 0) - (invoice.discountAmount || 0),
    );
    taxSummary = [
      {
        label: `${taxLabel} ${percent}%`,
        percent,
        taxable: formatMoney(taxableBase, currency, numberFormat || "comma"),
        amount: formatMoney(
          invoice.taxAmount,
          currency,
          numberFormat || "comma",
        ),
      },
    ];
  }
  const hasItemUnits = invoice.items.some(
    (i) => typeof i.unit === "string" && i.unit.trim().length > 0,
  );
  return {
    // Company
    companyName: settings?.companyName || "Your Company",
    companyAddress: _escapeHtmlWithBreaks(settings?.companyAddress || ""),
    companyCity: (settings?.companyCity || "").trim() || undefined,
    companyPostalCode: (settings?.companyPostalCode || "").trim() || undefined,
    companyPostalCity,
    companyEmail: settings?.companyEmail || "",
    companyPhone: settings?.companyPhone || "",
    companyTaxId: settings?.companyTaxId || "",

    // Invoice
    invoiceNumber: invoice.invoiceNumber,
    issueDate: formatDate(invoice.issueDate, dateFormat)!,
    dueDate: formatDate(invoice.dueDate, dateFormat),
    currency,
    status: invoice.status,

    // Customer
    customerName: invoice.customer.name,
    customerContactName: invoice.customer.contactName,
    customerEmail: invoice.customer.email,
    customerPhone: invoice.customer.phone,
    customerAddress: _escapeHtmlWithBreaks(invoice.customer.address),
    customerCity: invoice.customer.city,
    customerPostalCode: invoice.customer.postalCode,
    customerCountryCode: invoice.customer.countryCode,
    customerPostalCity: formatPostalCityLine(
      invoice.customer.postalCode,
      invoice.customer.city,
      invoice.customer.countryCode,
      settings?.postalCityFormat,
    ),
    customerTaxId: invoice.customer.taxId,

    // Items
    items: invoice.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unit: typeof i.unit === "string" && i.unit.trim().length > 0
        ? i.unit.trim()
        : undefined,
      unitPrice: formatMoney(i.unitPrice, currency, numberFormat || "comma"),
      lineTotal: formatMoney(i.lineTotal, currency, numberFormat || "comma"),
      notes: i.notes,
    })),
    hasItemUnits,

    // Totals
    subtotal: formatMoney(invoice.subtotal, currency, numberFormat || "comma"),
    discountAmount: invoice.discountAmount > 0
      ? formatMoney(invoice.discountAmount, currency, numberFormat || "comma")
      : undefined,
    discountPercentage: invoice.discountPercentage || undefined,
    taxRate: invoice.taxRate || undefined,
    taxAmount: invoice.taxAmount > 0
      ? formatMoney(invoice.taxAmount, currency, numberFormat || "comma")
      : undefined,
    total: formatMoney(invoice.total, currency, numberFormat || "comma"),
    taxSummary,
    hasTaxSummary: Boolean(taxSummary && taxSummary.length > 0),
    // Net subtotal (taxable base after discount, before tax) for convenience
    netSubtotal: formatMoney(
      Math.max(0, (invoice.subtotal || 0) - (invoice.discountAmount || 0)),
      currency,
      numberFormat || "comma",
    ),

    // Flags
    hasDiscount: invoice.discountAmount > 0,
    hasTax: invoice.taxAmount > 0,

    // Payment
    paymentTerms: invoice.paymentTerms || settings?.paymentTerms || undefined,
    paymentMethods: settings?.paymentMethods || undefined,
    bankAccount: settings?.bankAccount || undefined,

    // Notes
    notes: invoice.notes || settings?.defaultNotes || undefined,

    // Internationalization
    locale: resolvedLocale,
    labels,

    // Non-mustache extras consumed by templates
    // Prefer inlined data URL if available; otherwise pass through the provided logo value
    logoUrl: normalizeLogoUrlForRender(
      (settings as WithLogo | undefined)?.logoUrl ||
        (settings as WithLogo | undefined)?.logo,
      forceAbsoluteLogoUrl,
    ),
    // Permanently use logo-left layout
    brandLogoLeft: true,
  } as TemplateContext & { logoUrl?: string; brandLogoLeft?: boolean };
}

export async function generateInvoicePDF(
  invoiceData: InvoiceWithDetails,
  businessSettings?: BusinessSettings,
  templateId?: string,
  customHighlightColor?: string,
  opts?: {
    embedXmlProfileId?: string;
    embedXml?: boolean;
    xmlOptions?: Record<string, unknown>;
    dateFormat?: string;
    numberFormat?: "comma" | "period";
    locale?: string;
  },
): Promise<Uint8Array> {
  // Keep logos as normal URLs/files for WeasyPrint.
  // Data URLs significantly slow down rendering for larger images.
  const renderSettings = businessSettings;
  const html = buildInvoiceHTML(
    invoiceData,
    renderSettings,
    templateId,
    customHighlightColor,
    opts?.dateFormat,
    opts?.numberFormat,
    opts?.locale ?? invoiceData.locale ?? renderSettings?.locale,
    true,
  );
  const attachments: Array<{ fileName: string; bytes: Uint8Array }> = [];
  if (opts?.embedXml) {
    try {
      const profileId = opts.embedXmlProfileId || "ubl21";
      const { xml, profile } = generateInvoiceXML(
        profileId,
        invoiceData,
        renderSettings || ({} as BusinessSettings),
      );
      attachments.push({
        fileName: `invoice-${
          invoiceData.invoiceNumber || invoiceData.id
        }.${profile.fileExtension}`,
        bytes: new TextEncoder().encode(xml),
      });
    } catch (error) {
      console.warn("Failed to prepare XML attachment:", error);
    }
  }

  try {
    return await renderPdfWithWeasyPrint(html, attachments);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`WeasyPrint PDF rendering failed: ${msg}`);
  }
}

export function buildInvoiceHTML(
  invoice: InvoiceWithDetails,
  settings?: BusinessSettings,
  templateId?: string,
  highlight?: string,
  dateFormat?: string,
  numberFormat?: "comma" | "period",
  localeOverride?: string,
  forceAbsoluteLogoUrl = false,
): string {
  const ctx = buildContext(
    invoice,
    settings,
    highlight,
    dateFormat,
    numberFormat,
    localeOverride,
    forceAbsoluteLogoUrl,
  );
  const hl = normalizeHex(highlight) || "#2563eb";
  const hlLight = lighten(hl, 0.86);

  let template;
  if (templateId) {
    try {
      template = getTemplateById(templateId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to load template ${templateId}: ${message}`);
    }
  }

  const fallbackTemplate = template ?? getDefaultTemplate();
  if (!fallbackTemplate) {
    throw new Error(
      "No invoice templates available. Ensure database migrations have seeded templates.",
    );
  }

  return renderTpl(fallbackTemplate.html, {
    ...ctx,
    highlightColor: hl,
    highlightColorLight: hlLight,
  });
}

async function resolveWeasyPrintExecutable(): Promise<string | null> {
  const candidates: string[] = [];
  try {
    const configured = Deno.env.get("WEASYPRINT_BIN");
    if (configured && configured.trim().length > 0) {
      candidates.push(configured.trim());
    }
  } catch {
    // ignore env access errors
  }
  candidates.push("weasyprint");

  for (const candidate of candidates) {
    try {
      const probe = new Deno.Command(candidate, {
        args: ["--version"],
        stdout: "piped",
        stderr: "piped",
      });
      const { success } = await probe.output();
      if (success) return candidate;
    } catch {
      // continue probing
    }
  }
  return null;
}

async function runWeasyPrint(
  executable: string,
  inputHtmlPath: string,
  outputPdfPath: string,
  attachmentPaths: string[],
  includePdfVariant: boolean,
): Promise<void> {
  const args: string[] = [
    inputHtmlPath,
    outputPdfPath,
    "--media-type",
    "screen",
  ];
  if (includePdfVariant) {
    args.push("--pdf-variant", "pdf/a-3b");
  }
  for (const p of attachmentPaths) {
    args.push("--attachment", p);
  }

  const cmd = new Deno.Command(executable, {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(
      new TextDecoder().decode(stderr) || `weasyprint exited with code ${code}`,
    );
  }
}

function resolveCssVariablesForWeasy(html: string): string {
  const variableMap = new Map<string, string>();
  const rootVarRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = rootVarRegex.exec(html)) !== null) {
    variableMap.set(m[1], m[2].trim());
  }

  return html.replace(
    /var\(\s*--([a-zA-Z0-9_-]+)\s*(?:,[^)]+)?\)/g,
    (full, name) => {
      return variableMap.get(name) || full;
    },
  );
}

async function renderPdfWithWeasyPrint(
  html: string,
  attachments: Array<{ fileName: string; bytes: Uint8Array }>,
): Promise<Uint8Array> {
  const executable = await resolveWeasyPrintExecutable();
  if (!executable) {
    throw new Error(
      "WeasyPrint binary not found. Install `weasyprint` and set WEASYPRINT_BIN if needed.",
    );
  }

  const tmpDir = await Deno.makeTempDir({ prefix: "invio-weasy-" });
  const htmlPath = join(tmpDir, "invoice.html");
  const pdfPath = join(tmpDir, "invoice.pdf");

  try {
    const preparedHtml = resolveCssVariablesForWeasy(html);
    await Deno.writeTextFile(htmlPath, preparedHtml);

    const attachmentPaths: string[] = [];
    for (const attachment of attachments) {
      const safeName = attachment.fileName.replaceAll("/", "_");
      const path = join(tmpDir, safeName);
      await Deno.writeFile(path, attachment.bytes);
      attachmentPaths.push(path);
    }

    await runWeasyPrint(executable, htmlPath, pdfPath, attachmentPaths, true);

    return await Deno.readFile(pdfPath);
  } finally {
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function embedXmlAttachment(
  pdfBytes: Uint8Array,
  xmlBytes: Uint8Array,
  fileName: string,
  mediaType: string,
  description: string,
  docLang?: string,
  profile?: XMLProfile,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const context = pdfDoc.context;
  const now = new Date();
  const paramsDict = context.obj({
    Size: PDFNumber.of(xmlBytes.length),
    CreationDate: PDFString.fromDate(now),
    ModDate: PDFString.fromDate(now),
  });

  const subtypeName = mediaType.includes("/")
    ? mediaType.replace("/", "#2F")
    : mediaType;

  const embeddedFileStream = context.stream(xmlBytes, {
    Type: PDFName.of("EmbeddedFile"),
    Subtype: PDFName.of(subtypeName),
    Params: paramsDict,
  });
  const embeddedFileRef = context.register(embeddedFileStream);

  const efDict = context.obj({
    F: embeddedFileRef,
    UF: embeddedFileRef,
  });

  const fileSpecDict = context.obj({
    Type: PDFName.of("Filespec"),
    F: PDFString.of(fileName),
    UF: PDFString.of(fileName),
    EF: efDict,
    Desc: PDFString.of(description),
    AFRelationship: PDFName.of("Data"),
  });
  const fileSpecRef = context.register(fileSpecDict);

  let namesDict = pdfDoc.catalog.get(PDFName.of("Names"));
  if (!(namesDict instanceof PDFDict)) {
    const created = context.obj({});
    pdfDoc.catalog.set(PDFName.of("Names"), created);
    namesDict = created;
  }
  const namesDictObj = namesDict as PDFDict;

  let embeddedFilesDict = namesDictObj.get(PDFName.of("EmbeddedFiles"));
  if (!(embeddedFilesDict instanceof PDFDict)) {
    const created = context.obj({});
    namesDictObj.set(PDFName.of("EmbeddedFiles"), created);
    embeddedFilesDict = created;
  }
  const embeddedFilesDictObj = embeddedFilesDict as PDFDict;

  let namesArray = embeddedFilesDictObj.get(PDFName.of("Names"));
  if (!(namesArray instanceof PDFArray)) {
    const created = context.obj([]);
    embeddedFilesDictObj.set(PDFName.of("Names"), created);
    namesArray = created;
  }
  const namesArrayObj = namesArray as PDFArray;
  namesArrayObj.push(PDFString.of(fileName));
  namesArrayObj.push(fileSpecRef);

  let afArray = pdfDoc.catalog.get(PDFName.of("AF"));
  if (!(afArray instanceof PDFArray)) {
    const created = context.obj([]);
    pdfDoc.catalog.set(PDFName.of("AF"), created);
    afArray = created;
  }
  const afArrayObj = afArray as PDFArray;
  afArrayObj.push(fileSpecRef);

  pdfDoc.setSubject(`Embedded XML: ${fileName}`);
  pdfDoc.setKeywords(["Invoice", "Embedded XML", fileName]);
  pdfDoc.setModificationDate(now);
  if (docLang) {
    pdfDoc.catalog.set(PDFName.of("Lang"), PDFString.of(docLang));
  }

  if (profile && (profile.id === "facturx22" || profile.id === "zugferd")) {
    const xmp = generateZugferdXMP(fileName, "EN16931");
    const metadataStream = context.stream(xmp, {
      Type: PDFName.of("Metadata"),
      Subtype: PDFName.of("XML"),
    });
    const metadataRef = context.register(metadataStream);
    pdfDoc.catalog.set(PDFName.of("Metadata"), metadataRef);
  }

  return pdfDoc.save({ useObjectStreams: false });
}

// Alias for backward compatibility
export const generatePDF = generateInvoicePDF;
