import { useEffect, useState } from "preact/hooks";
import { useTranslations } from "../i18n/context.tsx";

type Props = {
  size?: "sm" | "md" | "lg";
  class?: string;
  label?: string;
};

const THEME_KEY = "theme";
const LIGHT = "light";
const DARK = "dark";

export default function ThemeToggle(props: Props) {
  const { t } = useTranslations();
  const [theme, setTheme] = useState<string>(LIGHT);

  // Initialize from localStorage or prefers-color-scheme
  useEffect(() => {
    try {
      const stored = globalThis.localStorage?.getItem(THEME_KEY) || "";
      const preferred =
        globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? DARK
          : LIGHT;
      const initial = (stored === LIGHT || stored === DARK)
        ? stored
        : preferred;
      setTheme(initial);
      document.documentElement.setAttribute("data-theme", initial);
    } catch (_err) {
      // ignore
    }
  }, []);

  const toggle = () => {
    const next = theme === DARK ? LIGHT : DARK;
    setTheme(next);
    try {
      document.documentElement.setAttribute("data-theme", next);
      globalThis.localStorage?.setItem(THEME_KEY, next);
    } catch (_err) {
      // ignore persistence errors
    }
  };

  const size = props.size ?? "md";
  const cls = `btn btn-ghost ${
    size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : ""
  } ${props.class ?? ""}`;

  const defaultLabel = t("Toggle light/dark theme");
  const buttonLabel = props.label ?? defaultLabel;

  return (
    <button
      type="button"
      class={cls}
      onClick={toggle}
      aria-label={buttonLabel}
      title={buttonLabel}
    >
      {/* sun/moon icon swap */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class={`h-5 w-5 ${theme === DARK ? "hidden" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class={`h-5 w-5 ${theme === DARK ? "" : "hidden"}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      <span class="ml-2 hidden sm:inline text-sm opacity-70">
        {theme === DARK ? t("Dark") : t("Light")}
      </span>
    </button>
  );
}
