import { createContext } from "preact";
import { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { DEFAULT_LOCALIZATION, LocalizationConfig } from "./mod.ts";

export const LocalizationContext = createContext<LocalizationConfig>(
  DEFAULT_LOCALIZATION,
);

export function LocalizationProvider(
  props: { value: LocalizationConfig; children: ComponentChildren },
) {
  return (
    <LocalizationContext.Provider value={props.value}>
      {props.children}
    </LocalizationContext.Provider>
  );
}

export function useTranslations() {
  try {
    const context = useContext(LocalizationContext);
    // During SSR, context might be undefined if not yet wrapped by provider
    return context ?? DEFAULT_LOCALIZATION;
  } catch (_error) {
    // If useContext fails during SSR (e.g., context not properly initialized),
    // fall back to default localization
    return DEFAULT_LOCALIZATION;
  }
}
