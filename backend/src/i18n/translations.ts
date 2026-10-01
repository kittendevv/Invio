import enRaw from "./locales/en.json" with { type: "json" };
import nlRaw from "./locales/nl.json" with { type: "json" };
import deRaw from "./locales/de.json" with { type: "json" };
import ptBrRaw from "./locales/pt-br.json" with { type: "json" };
import trRaw from "./locales/tr.json" with { type: "json" };
import esCoRaw from "./locales/es-co.json" with { type: "json" };
import esArRaw from "./locales/es-ar.json" with { type: "json" };

export type InvoiceLabels = {
  invoiceTitle: string;
  invoiceNumberLabel: string;
  invoiceNumberShortLabel: string;
  invoiceDateLabel: string;
  dateLabel: string;
  dueDateLabel: string;
  dueShortLabel: string;
  referenceLabel: string;
  billToHeading: string;
  itemsHeading: string;
  itemHeaderDescription: string;
  itemHeaderQuantity: string;
  itemHeaderQuantityShort: string;
  itemHeaderUnit: string;
  itemHeaderUnitPrice: string;
  itemHeaderUnitPriceShort: string;
  itemHeaderAmount: string;
  itemHeaderTax: string;
  summaryHeading: string;
  subtotalLabel: string;
  discountLabel: string;
  taxLabel: string;
  totalLabel: string;
  statusLabel: string;
  taxSummaryHeading: string;
  taxableLabel: string;
  taxAmountLabel: string;
  taxIdLabel: string;
  outstandingBalanceLabel: string;
  paymentInformationHeading: string;
  paymentMethodsLabel: string;
  paymentMethodsPrefix: string;
  bankAccountLabel: string;
  bankAccountPrefix: string;
  paymentTermsLabel: string;
  notesHeading: string;
  thankYouNote: string;
};

const REQUIRED_KEYS = [
  "invoiceTitle",
  "invoiceNumberLabel",
  "invoiceNumberShortLabel",
  "invoiceDateLabel",
  "dateLabel",
  "dueDateLabel",
  "dueShortLabel",
  "referenceLabel",
  "billToHeading",
  "itemsHeading",
  "itemHeaderDescription",
  "itemHeaderQuantity",
  "itemHeaderQuantityShort",
  "itemHeaderUnit",
  "itemHeaderUnitPrice",
  "itemHeaderUnitPriceShort",
  "itemHeaderAmount",
  "itemHeaderTax",
  "summaryHeading",
  "subtotalLabel",
  "discountLabel",
  "taxLabel",
  "totalLabel",
  "statusLabel",
  "taxSummaryHeading",
  "taxableLabel",
  "taxAmountLabel",
  "taxIdLabel",
  "outstandingBalanceLabel",
  "paymentInformationHeading",
  "paymentMethodsLabel",
  "paymentMethodsPrefix",
  "bankAccountLabel",
  "bankAccountPrefix",
  "paymentTermsLabel",
  "notesHeading",
  "thankYouNote",
] as const;

function coerceLabels(locale: string, raw: unknown): InvoiceLabels {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid translation data for locale '${locale}'`);
  }
  const record = raw as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (typeof record[key] !== "string") {
      throw new Error(
        `Missing or invalid key '${key}' in locale '${locale}' translations`,
      );
    }
  }
  return Object.freeze(record as InvoiceLabels);
}

const catalogs: Record<string, InvoiceLabels> = Object.freeze({
  en: coerceLabels("en", enRaw),
  nl: coerceLabels("nl", nlRaw),
  de: coerceLabels("de", deRaw),
  "pt-br": coerceLabels("pt-br", ptBrRaw),
  pt: coerceLabels("pt", ptBrRaw), // alias for pt-br
  tr: coerceLabels("tr", trRaw),
  "es-co": coerceLabels("es-co", esCoRaw),
  es: coerceLabels("es", esCoRaw), // alias for es-co
  "es-ar": coerceLabels("es-ar", esArRaw),
});

function normalizeLocale(locale?: string): string {
  if (!locale) return "en";
  const lower = locale.toLowerCase();
  if (catalogs[lower]) return lower;
  const base = lower.split("-")[0];
  if (catalogs[base]) return base;
  return "en";
}

export function getInvoiceLabels(
  locale?: string,
): { locale: string; labels: InvoiceLabels } {
  const normalized = normalizeLocale(locale);
  return { locale: normalized, labels: catalogs[normalized] };
}

export function availableInvoiceLocales(): string[] {
  return Object.keys(catalogs);
}

const SUPPORTED_LOCALES = new Set(availableInvoiceLocales());

// Map a user-supplied locale to a supported invoice locale (exact, then base
// language, then "en"). Returns undefined for empty input.
export function normalizeInvoiceLocaleSetting(
  raw: unknown,
): string | undefined {
  const lower = String(raw ?? "").trim().toLowerCase();
  if (!lower) return undefined;
  if (SUPPORTED_LOCALES.has(lower)) return lower;
  const base = lower.split("-")[0];
  if (SUPPORTED_LOCALES.has(base)) return base;
  return "en";
}

function deriveLocaleFromCountryCode(countryCode?: string): string | undefined {
  if (!countryCode) return undefined;
  const code = String(countryCode).trim().toUpperCase();
  if (!code) return undefined;

  // Keep mapping constrained to currently supported invoice locales
  if (code === "DE" || code === "AT" || code === "CH") return "de";
  if (code === "NL" || code === "BE") return "nl";
  if (code === "PT" || code === "BR") return "pt-br";
  if (code === "TR") return "tr";
  if (code === "ES" || code === "CO") return "es-co";
  if (["AU", "CA", "GB", "IE", "NZ", "US", "AG", "BS", "BB", "BZ", "DM", "GD", "GY", "JM", "KN", "LC", "VC", "TT"].includes(code)) return "en";

  return undefined;
}

// Resolution order: invoice locale -> customer country -> invoice fallback
// locale setting -> UI locale setting -> "en"
export function resolveInvoiceRenderLocale(
  invoiceLocale: string | undefined,
  customerCountryCode: string | undefined,
  fallbackLocale: string | undefined,
  settingsLocale: string | undefined,
): string {
  const fromInvoice = invoiceLocale?.trim().toLowerCase();
  if (fromInvoice && SUPPORTED_LOCALES.has(fromInvoice)) return fromInvoice;

  const fromCountry = deriveLocaleFromCountryCode(customerCountryCode);
  if (fromCountry && SUPPORTED_LOCALES.has(fromCountry)) return fromCountry;

  const fromFallback = fallbackLocale?.trim().toLowerCase();
  if (fromFallback && SUPPORTED_LOCALES.has(fromFallback)) return fromFallback;

  const fromSettings = settingsLocale?.trim().toLowerCase();
  if (fromSettings && SUPPORTED_LOCALES.has(fromSettings)) return fromSettings;

  return "en";
}
