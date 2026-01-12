import enMessages from "./locales/en.json" with { type: "json" };
import nlMessages from "./locales/nl.json" with { type: "json" };
import deMessages from "./locales/de.json" with { type: "json" };
import ptMessages from "./locales/pt-br.json" with { type: "json" };

export type UiMessages = Record<string, string>;
export type TranslateParams = Record<string, string | number>;

const catalogs: Record<string, UiMessages> = {
  en: enMessages as UiMessages,
  nl: nlMessages as UiMessages,
  de: deMessages as UiMessages,
  pt: ptMessages as UiMessages,
};

const DEFAULT_LOCALE = "en";

function normalizeLocale(locale?: string): string {
  if (!locale) return DEFAULT_LOCALE;
  const lower = locale.toLowerCase();
  if (lower in catalogs) return lower;
  const base = lower.split("-")[0];
  if (base in catalogs) return base;
  return DEFAULT_LOCALE;
}

export function listAvailableLocales(): string[] {
  return Object.keys(catalogs);
}

function formatWithParams(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export type TranslateFn = (key: string, params?: TranslateParams) => string;

export function createTranslator(locale?: string): {
  locale: string;
  messages: UiMessages;
  t: TranslateFn;
} {
  const normalized = normalizeLocale(locale);
  const messages = catalogs[normalized] || catalogs[DEFAULT_LOCALE];

  const t: TranslateFn = (key, params) => {
    const template = messages[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
    return formatWithParams(template, params);
  };

  return { locale: normalized, messages, t };
}

export type LocalizationConfig = {
  locale: string;
  messages: UiMessages;
  t: TranslateFn;
  numberFormat: "comma" | "period";
  dateFormat: string;
};

export const DEFAULT_LOCALIZATION: LocalizationConfig = {
  ...createTranslator(DEFAULT_LOCALE),
  numberFormat: "comma",
  dateFormat: "YYYY-MM-DD",
};

export function resolveLocalization(
  locale?: string,
  numberFormat?: string,
  dateFormat?: string,
): LocalizationConfig {
  const { locale: normalized, messages, t } = createTranslator(locale);
  const nf = numberFormat === "period" ? "period" : "comma";
  const df = typeof dateFormat === "string" && dateFormat.trim()
    ? dateFormat
    : "YYYY-MM-DD";
  return { locale: normalized, messages, t, numberFormat: nf, dateFormat: df };
}
