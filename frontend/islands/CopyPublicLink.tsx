import { useEffect } from "preact/hooks";
import { useTranslations } from "../i18n/context.tsx";

export default function CopyPublicLink() {
  const { t } = useTranslations();
  useEffect(() => {
    const btn = document.getElementById("copy-public-link");
    const urlEl = document.getElementById("public-link-url");
    if (!btn || !urlEl) return;
    const fallbackLabel = t("Copy link");
    const successLabel = t("Copied!");
    if (!btn.dataset.originalLabel) {
      btn.dataset.originalLabel = btn.textContent?.trim() || fallbackLabel;
    }
    const onClick = async () => {
      try {
        const text = urlEl.textContent || (urlEl as HTMLAnchorElement).href ||
          "";
        await navigator.clipboard.writeText(text);
        const original = btn.dataset.originalLabel || fallbackLabel;
        btn.textContent = successLabel;
        setTimeout(() => {
          btn.textContent = original;
        }, 1200);
      } catch (_e) { /* ignore */ }
    };
    btn.addEventListener("click", onClick);
    return () => btn.removeEventListener("click", onClick);
  }, [t]);
  return null;
}
