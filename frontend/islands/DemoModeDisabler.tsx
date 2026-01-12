import { useEffect } from "preact/hooks";

export default function DemoModeDisabler() {
  useEffect(() => {
    try {
      const sel = "[data-writable]";
      document.querySelectorAll(sel).forEach((el) => {
        if (el instanceof HTMLElement) {
          el.setAttribute("disabled", "true");
          el.classList.add("opacity-50", "cursor-not-allowed");
        }
      });
    } catch (_e) { /* ignore */ }
  }, []);
  return null;
}
