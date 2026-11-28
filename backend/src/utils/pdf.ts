import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  PDFString,
} from "pdf-lib";
import { generateInvoiceXML, XMLProfile } from "./xmlProfiles.ts";
import { mergeZugferdIntoXMP } from "./xmp.ts";
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
  const { locale: resolvedLocale, labels: baseLabels } = getInvoiceLabels(
    requestedLocale,
  );
  const isCreditNote = invoice.documentType === "credit_note";
  const isQuote = invoice.documentType === "quote";
  // Templates only know the invoice labels; credit notes and quotes swap in
  // their own wording so every template (including custom ones) renders
  // them correctly. A quote's due date is its valid-until date.
  const labels = isCreditNote
    ? {
      ...baseLabels,
      invoiceTitle: baseLabels.creditNoteTitle,
      invoiceNumberLabel: baseLabels.creditNoteNumberLabel,
      invoiceNumberShortLabel: baseLabels.creditNoteNumberShortLabel,
      invoiceDateLabel: baseLabels.creditNoteDateLabel,
      itemsHeading: baseLabels.creditNoteItemsHeading,
      summaryHeading: baseLabels.creditNoteSummaryHeading,
    }
    : isQuote
    ? {
      ...baseLabels,
      invoiceTitle: baseLabels.quoteTitle,
      invoiceNumberLabel: baseLabels.quoteNumberLabel,
      invoiceNumberShortLabel: baseLabels.quoteNumberShortLabel,
      invoiceDateLabel: baseLabels.quoteDateLabel,
      dueDateLabel: baseLabels.quoteValidUntilLabel,
      dueShortLabel: baseLabels.quoteValidUntilLabel,
      itemsHeading: baseLabels.quoteItemsHeading,
      summaryHeading: baseLabels.quoteSummaryHeading,
      billToHeading: baseLabels.quoteBillToHeading,
    }
    : baseLabels;
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
    isCreditNote,
    isQuote,
    creditedInvoiceNumber: invoice.creditedInvoice?.invoiceNumber,
    creditedInvoiceDate: formatDate(
      invoice.creditedInvoice?.issueDate,
      dateFormat,
    ),

    // Customer
    customerName: invoice.customer.name,
    customerContactName: invoice.customer.contactName,
    customerEmail: invoice.customer.email,
    customerPhone: invoice.customer.phone,
    customerAddress: _escapeHtmlWithBreaks(invoice.customer.address),
    customerCity: invoice.customer.city,
    customerPostalCode: invoice.customer.postalCode,
    customerRegion: invoice.customer.region,
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
    // Nothing is payable on a quote yet
    paymentMethods: isQuote ? undefined : settings?.paymentMethods || undefined,
    bankAccount: isQuote ? undefined : settings?.bankAccount || undefined,

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

/** Download/attachment file name, e.g. invoice-INV-001.pdf or credit-note-CN-001.pdf */
export function documentFileName(
  invoice: { invoiceNumber?: string; documentType?: string },
  fallback: string,
  extension: string,
): string {
  const prefix = invoice.documentType === "credit_note"
    ? "credit-note"
    : invoice.documentType === "quote"
    ? "quote"
    : "invoice";
  return `${prefix}-${invoice.invoiceNumber || fallback}.${extension}`;
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
  let facturx: { xml: Uint8Array; profile: XMLProfile } | undefined;
  // Quotes are not invoices: never attach e-invoice XML to them
  if (opts?.embedXml && invoiceData.documentType !== "quote") {
    try {
      const profileId = opts.embedXmlProfileId || "ubl21";
      const { xml, profile } = generateInvoiceXML(
        profileId,
        invoiceData,
        renderSettings || ({} as BusinessSettings),
      );
      const bytes = new TextEncoder().encode(xml);
      if (isFacturXProfile(profile)) {
        // Factur-X / ZUGFeRD needs a fixed file name, AFRelationship and XMP
        // metadata that WeasyPrint's generic --attachment does not provide.
        facturx = { xml: bytes, profile };
      } else {
        attachments.push({
          fileName: documentFileName(
            invoiceData,
            invoiceData.id,
            profile.fileExtension,
          ),
          bytes,
        });
      }
    } catch (error) {
      console.warn("Failed to prepare XML attachment:", error);
    }
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderPdfWithWeasyPrint(html, attachments);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`WeasyPrint PDF rendering failed: ${msg}`);
  }

  if (facturx) {
    pdfBytes = await embedFacturXAttachment(pdfBytes, facturx.xml);
  }
  return pdfBytes;
}

function isFacturXProfile(profile: XMLProfile): boolean {
  return profile.id === "facturx22" || profile.id === "zugferd";
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

// File name mandated by Factur-X 1.0 / ZUGFeRD 2.x for the embedded invoice XML.
export const FACTURX_FILE_NAME = "factur-x.xml";

/**
 * Embed a Factur-X / ZUGFeRD CII XML into a PDF/A-3 document as required by the
 * standard: file name "factur-x.xml", MIME type text/xml, AFRelationship
 * "Alternative", referenced from the catalog /AF array, and the fx: XMP
 * properties merged into the document metadata. The document info dictionary is
 * left untouched so it stays in sync with the XMP (PDF/A requirement).
 */
export async function embedFacturXAttachment(
  pdfBytes: Uint8Array,
  xmlBytes: Uint8Array,
  conformanceLevel = "EN 16931",
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const context = pdfDoc.context;
  const fileName = FACTURX_FILE_NAME;
  const now = PDFString.fromDate(new Date());

  const embeddedFileStream = context.flateStream(xmlBytes, {
    Type: PDFName.of("EmbeddedFile"),
    Subtype: PDFName.of("text/xml"),
    Params: context.obj({
      Size: PDFNumber.of(xmlBytes.length),
      ModDate: now,
    }),
  });
  const embeddedFileRef = context.register(embeddedFileStream);

  const fileSpecRef = context.register(context.obj({
    Type: PDFName.of("Filespec"),
    F: PDFString.of(fileName),
    UF: PDFHexString.fromText(fileName),
    EF: context.obj({ F: embeddedFileRef, UF: embeddedFileRef }),
    Desc: PDFString.of("Factur-X/ZUGFeRD invoice"),
    AFRelationship: PDFName.of("Alternative"),
  }));

  // /Names /EmbeddedFiles name tree
  const catalog = pdfDoc.catalog;
  let namesDict = catalog.lookup(PDFName.of("Names"));
  if (!(namesDict instanceof PDFDict)) {
    namesDict = context.obj({});
    catalog.set(PDFName.of("Names"), namesDict);
  }
  const names = namesDict as PDFDict;
  let efTree = names.lookup(PDFName.of("EmbeddedFiles"));
  if (!(efTree instanceof PDFDict)) {
    efTree = context.obj({});
    names.set(PDFName.of("EmbeddedFiles"), efTree);
  }
  const efTreeDict = efTree as PDFDict;
  let namesArray = efTreeDict.lookup(PDFName.of("Names"));
  if (!(namesArray instanceof PDFArray)) {
    namesArray = context.obj([]);
    efTreeDict.set(PDFName.of("Names"), namesArray);
  }
  // Name tree keys must be sorted; "factur-x.xml" goes first unless an
  // existing key sorts before it.
  const arr = namesArray as PDFArray;
  let insertAt = arr.size();
  for (let i = 0; i < arr.size(); i += 2) {
    const key = arr.lookup(i);
    const keyText = key instanceof PDFString || key instanceof PDFHexString
      ? key.decodeText()
      : "";
    if (keyText > fileName) {
      insertAt = i;
      break;
    }
  }
  arr.insert(insertAt, fileSpecRef);
  arr.insert(insertAt, PDFString.of(fileName));

  // Associated files on the document catalog (PDF/A-3)
  let afArray = catalog.lookup(PDFName.of("AF"));
  if (!(afArray instanceof PDFArray)) {
    afArray = context.obj([]);
    catalog.set(PDFName.of("AF"), afArray);
  }
  (afArray as PDFArray).push(fileSpecRef);

  // Merge fx: metadata into the existing XMP so PDF/A identification is kept.
  const existingXmp = readCatalogXmp(pdfDoc);
  const xmp = mergeZugferdIntoXMP(existingXmp, fileName, conformanceLevel);
  const metadataRef = context.register(
    context.stream(new TextEncoder().encode(xmp), {
      Type: PDFName.of("Metadata"),
      Subtype: PDFName.of("XML"),
    }),
  );
  catalog.set(PDFName.of("Metadata"), metadataRef);

  // PDF/A requires a file identifier in the trailer; older WeasyPrint versions
  // (e.g. 57.x shipped with Debian 12) do not write one.
  if (!context.trailerInfo.ID) {
    const id = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    context.trailerInfo.ID = context.obj([
      PDFHexString.of(id),
      PDFHexString.of(id),
    ]);
  }

  return pdfDoc.save({ useObjectStreams: false });
}

function readCatalogXmp(pdfDoc: PDFDocument): string | undefined {
  const stream = pdfDoc.catalog.lookup(PDFName.of("Metadata"));
  if (!(stream instanceof PDFStream)) return undefined;
  try {
    const bytes = stream instanceof PDFRawStream
      ? decodePDFRawStream(stream).decode()
      : stream.getContents();
    return new TextDecoder().decode(bytes);
  } catch (error) {
    console.warn("Failed to read existing XMP metadata:", error);
    return undefined;
  }
}

// Alias for backward compatibility
export const generatePDF = generateInvoicePDF;
