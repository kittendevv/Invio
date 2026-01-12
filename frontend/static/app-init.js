(function () {
  // Set data-theme ASAP from localStorage or prefers-color-scheme
  try {
    const root = document.documentElement;
    const KEY = "theme";
    let stored = null;
    try {
      stored = globalThis.localStorage ? localStorage.getItem(KEY) : null;
    } catch (_) {
      stored = null;
    }
    let prefersDark = false;
    try {
      prefersDark = !!(globalThis.matchMedia &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    } catch (_) {
      prefersDark = false;
    }
    const theme = (stored === "light" || stored === "dark")
      ? stored
      : (prefersDark ? "dark" : "light");
    root.setAttribute("data-theme", theme);
  } catch (_err) {
    // ignore theme init errors
  }
})();

(function () {
  function init() {
    try {
      const lucide = globalThis.lucide;
      if (lucide && typeof lucide.createIcons === "function") {
        lucide.createIcons();
      } else {
        // Retry if lucide isn't loaded yet
        setTimeout(init, 100);
      }
    } catch (_err) {
      // ignore lucide init errors
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
