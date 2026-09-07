import enRaw from "./locales/en.json" with { type: "json" };
import nlRaw from "./locales/nl.json" with { type: "json" };
import deRaw from "./locales/de.json" with { type: "json" };
import ptBrRaw from "./locales/pt-br.json" with { type: "json" };
import trRaw from "./locales/tr.json" with { type: "json" };
import esCoRaw from "./locales/es-co.json" with { type: "json" };
import esMxRaw from "./locales/es-mx.json" with { type: "json" };
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
  "es-mx": coerceLabels("es-mx", esMxRaw),
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
