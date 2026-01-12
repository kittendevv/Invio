import { useState } from "preact/hooks";
import { useTranslations } from "../i18n/context.tsx";

function getAuthHeaderFromCookie(cookie: string): string | null {
  const parts = cookie.split(/;\s*/);
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i === -1) continue;
    const k = decodeURIComponent(p.slice(0, i));
    const v = decodeURIComponent(p.slice(i + 1));
    if (k === "invio_session" && v) return `Bearer ${v}`;
  }
  return null;
}

export default function InstallTemplateForm() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { t } = useTranslations();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        const u = url.trim();
        if (!u) return setErr(t("Enter a manifest URL"));
        try {
          setBusy(true);
          const auth = getAuthHeaderFromCookie(document.cookie);
          const res = await fetch("/api/templates/install", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(auth ? { Authorization: auth } : {}),
            },
            body: JSON.stringify({ url: u }),
          });
          if (!res.ok) {
            let message = t("Template install failed with status {{status}}", {
              status: `${res.status} ${res.statusText}`,
            });
            try {
              const data = await res.json();
              if (data && (data.error || data.message)) {
                message = String(data.error || data.message);
              }
            } catch (_) { /* ignore parse issues */ }
            throw new Error(message);
          }
          globalThis.location?.reload();
        } catch (e) {
          setErr(String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label class="form-control">
        <div class="label">
          <span class="label-text">{t("Install from Manifest URL")}</span>
        </div>
        <div class="flex gap-2">
          <input
            name="manifestUrl"
            class="input input-bordered w-full"
            placeholder={t("Manifest URL placeholder")}
            value={url}
            onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)}
          />
          <button type="submit" class="btn btn-primary" disabled={busy}>
            {t("Install")}
          </button>
        </div>
        {err && <span class="text-error text-sm mt-1">{err}</span>}
      </label>
    </form>
  );
}
