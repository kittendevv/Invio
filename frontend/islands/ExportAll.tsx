import { useRef, useState } from "preact/hooks";
import { useTranslations } from "../i18n/context.tsx";

export default function ExportAll() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const { t } = useTranslations();

  async function onExportClick(ev: Event) {
    ev.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const includeDb = String(fd.get("includeDb") || "true");
    const includeJson = String(fd.get("includeJson") || "true");
    const includeAssets = String(fd.get("includeAssets") || "true");
    const username = String(fd.get("username") || "");
    const password = String(fd.get("password") || "");
    if (!username || !password) {
      setStatus(t("Please enter username and password."));
      return;
    }
    setBusy(true);
    setStatus(t("Preparing export..."));
    try {
      const loginResp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!loginResp.ok) {
        const text = await loginResp.text();
        throw new Error(text || `Login failed (${loginResp.status})`);
      }
      const login = await loginResp.json() as { token?: string };
      if (!login?.token) {
        throw new Error("Login response missing token");
      }
      const url = `/api/admin/export/full?includeDb=${
        encodeURIComponent(includeDb)
      }&includeJson=${encodeURIComponent(includeJson)}&includeAssets=${
        encodeURIComponent(includeAssets)
      }`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${login.token}` },
      });
      if (!resp.ok) {
        const responseText = await resp.text();
        const fallback = t("Export failed with status {{status}}", {
          status: String(resp.status),
        });
        throw new Error(responseText || fallback);
      }
      const blob = await resp.blob();
      const cd = resp.headers.get("content-disposition") ||
        'attachment; filename="invio-export.tar.gz"';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const name = (m && m[1]) || "invio-export.tar.gz";
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      setStatus(t("Export downloaded."));
    } catch (err) {
      console.error(err);
      const message = err && (err as Error).message
        ? (err as Error).message
        : String(err);
      setStatus(t("Export failed: {{message}}", { message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="max-w-2xl">
      <p class="mb-3 opacity-80">{t("Export all data intro")}</p>
      <form ref={formRef} class="space-y-3" data-writable>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label class="form-control">
            <div class="label">
              <span class="label-text">{t("Include database file")}</span>
            </div>
            <select
              name="includeDb"
              class="select select-bordered w-full"
              data-writable
            >
              <option value="true">{t("Yes")}</option>
              <option value="false">{t("No")}</option>
            </select>
          </label>
          <label class="form-control">
            <div class="label">
              <span class="label-text">{t("Include JSON dump")}</span>
            </div>
            <select
              name="includeJson"
              class="select select-bordered w-full"
              data-writable
            >
              <option value="true">{t("Yes")}</option>
              <option value="false">{t("No")}</option>
            </select>
          </label>
          <label class="form-control">
            <div class="label">
              <span class="label-text">{t("Include template assets")}</span>
            </div>
            <select
              name="includeAssets"
              class="select select-bordered w-full"
              data-writable
            >
              <option value="true">{t("Yes")}</option>
              <option value="false">{t("No")}</option>
            </select>
          </label>
        </div>
        <div class="divider" />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="form-control">
            <div class="label">
              <span class="label-text">{t("Re-enter admin username")}</span>
            </div>
            <input
              name="username"
              class="input input-bordered"
              placeholder={t("Admin username placeholder")}
              required
              data-writable
            />
          </label>
          <label class="form-control">
            <div class="label">
              <span class="label-text">{t("Re-enter admin password")}</span>
            </div>
            <input
              name="password"
              type="password"
              class="input input-bordered"
              placeholder={t("Admin password placeholder")}
              required
              data-writable
            />
          </label>
        </div>
        <div class="pt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onExportClick}
            disabled={busy}
            class="btn btn-primary"
            data-writable
          >
            {busy ? t("Exporting...") : t("Export all data")}
          </button>
          <span class="text-sm opacity-70">{status}</span>
        </div>
      </form>
    </div>
  );
}
