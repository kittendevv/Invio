import enMessages from "./locales/en.json" with { type: "json" };
import nlMessages from "./locales/nl.json" with { type: "json" };
import deMessages from "./locales/de.json" with { type: "json" };
import ptMessages from "./locales/pt-br.json" with { type: "json" };
import trMessages from "./locales/tr.json" with { type: "json" };
import esMessages from "./locales/es-co.json" with { type: "json" };
import esMxMessages from "./locales/es-mx.json" with { type: "json" };
import esArMessages from "./locales/es-ar.json" with { type: "json" };

export type UiMessages = Record<string, string>;
export type TranslateParams = Record<string, string | number>;

const catalogs: Record<string, UiMessages> = {
  en: enMessages as UiMessages,
  nl: nlMessages as UiMessages,
  de: deMessages as UiMessages,
  pt: ptMessages as UiMessages,
  tr: trMessages as UiMessages,
  es: esMessages as UiMessages,
  "es-mx": esMxMessages as UiMessages,
  "es-ar": esArMessages as UiMessages,
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
  postalCityFormat: "auto" | "city-postal" | "postal-city";
};

export const DEFAULT_LOCALIZATION: LocalizationConfig = {
  ...createTranslator(DEFAULT_LOCALE),
  numberFormat: "comma",
  dateFormat: "YYYY-MM-DD",
  postalCityFormat: "auto",
};

export function resolveLocalization(
  locale?: string,
  numberFormat?: string,
  dateFormat?: string,
  postalCityFormat?: string,
): LocalizationConfig {
  const { locale: normalized, messages, t } = createTranslator(locale);
  const nf = numberFormat === "period" ? "period" : "comma";
  const df =
    typeof dateFormat === "string" && dateFormat.trim()
      ? dateFormat
      : "YYYY-MM-DD";
  const pcf =
    postalCityFormat === "city-postal" || postalCityFormat === "postal-city"
      ? postalCityFormat
      : "auto";
  return {
    locale: normalized,
    messages,
    t,
    numberFormat: nf,
    dateFormat: df,
    postalCityFormat: pcf,
  };
}
