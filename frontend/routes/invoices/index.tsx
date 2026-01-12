import { PageProps } from "fresh";
import { Layout } from "../../components/Layout.tsx";
import { LuPlus } from "../../components/icons.tsx";
import { formatMoney, getNumberFormat } from "../../utils/format.ts";
import { backendGet, getAuthHeaderFromCookie } from "../../utils/backend.ts";
import { renderPage } from "../../utils/render.tsx";
import { useTranslations } from "../../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type Invoice = {
  id: string;
  invoiceNumber?: string;
  customer?: { name?: string };
  issue_date?: string;
  total?: number;
  status?: "draft" | "sent" | "paid" | "overdue";
  currency?: string;
};
type Data = {
  authed: boolean;
  invoices?: Invoice[];
  error?: string;
  q?: string;
  status?: string;
  totalCount?: number;
  dateFormat?: string;
  settings?: Record<string, unknown>;
};

export const handler: Handlers<Data> = {
  async GET(ctx) {
    const req = ctx.req;
    const auth = getAuthHeaderFromCookie(
      req.headers.get("cookie") || undefined,
    );
    if (!auth) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/login" },
      });
    }
    try {
      const url = new URL(req.url);
      const q = (url.searchParams.get("q") || "").trim();
      const status = (url.searchParams.get("status") || "").trim();
      const [invoicesAll, settings] = await Promise.all([
        backendGet("/api/v1/invoices", auth) as Promise<Invoice[]>,
        backendGet("/api/v1/settings", auth).catch(() => ({})) as Promise<
          Record<string, unknown>
        >,
      ]);
      // Normalize for case/diacritics-insensitive search
      const norm = (s: unknown) =>
        String(s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "");
      const qLower = norm(q);
      const statusLower = status.toLowerCase();
      const invoices = invoicesAll.filter((inv) => {
        const st = String(inv.status || "").toLowerCase();
        const okStatus = !statusLower || st === statusLower;
        if (!qLower) return okStatus;
        const id = norm(inv.id);
        const cust = norm(inv.customer?.name);
        const num = norm(inv.invoiceNumber);
        const okText = id.includes(qLower) || cust.includes(qLower) ||
          num.includes(qLower);
        return okStatus && okText;
      });
      const dateFormat = String(settings.dateFormat || "YYYY-MM-DD");
      return renderPage(ctx, Invoices, {
        authed: true,
        invoices,
        q,
        status,
        totalCount: invoicesAll.length,
        dateFormat,
        settings,
      });
    } catch (e) {
      return renderPage(ctx, Invoices, { authed: true, error: String(e) });
    }
  },
};

export default function Invoices(props: PageProps<Data>) {
  const { t } = useTranslations();
  const list = props.data.invoices ?? [];
  const q = props.data.q ?? "";
  const status = props.data.status ?? "";
  const totalCount = props.data.totalCount ?? list.length;
  const dateFormat = props.data.dateFormat || "YYYY-MM-DD";
  const numberFormat = getNumberFormat(props.data.settings);
  const fmtDate = (s?: string) => {
    if (!s) return "";
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      if (dateFormat === "DD.MM.YYYY") {
        return `${day}.${month}.${year}`;
      }
      return `${year}-${month}-${day}`;
    } catch {
      return s || "";
    }
  };
  const formatInvoiceMoney = (inv: Invoice) =>
    typeof inv.total === "number"
      ? formatMoney(inv.total, inv.currency || "USD", numberFormat)
      : "";
  const statusBadge = (st?: Invoice["status"]) => {
    const cls = st === "paid"
      ? "badge-success"
      : st === "overdue"
      ? "badge-error"
      : st === "sent"
      ? "badge-info"
      : "";
    const label = st
      ? t(
        st === "paid"
          ? "Paid"
          : st === "overdue"
          ? "Overdue"
          : st === "sent"
          ? "Sent"
          : "Draft",
      )
      : "";
    return <span class={`badge ${cls}`}>{label}</span>;
  };
  const qsFor = (s: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s) p.set("status", s);
    return `?${p.toString()}`;
  };
  return (
    <Layout authed={props.data.authed} path={new URL(props.url).pathname}>
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 class="text-2xl font-semibold">{t("Invoices")}</h1>
        <a href="/invoices/new" class="btn btn-sm btn-primary w-full sm:w-auto">
          <LuPlus size={16} />
          {t("New Invoice")}
        </a>
      </div>
      {props.data.error && (
        <div class="alert alert-error mb-3">
          <span>{props.data.error}</span>
        </div>
      )}
      <div class="mb-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <form
          method="get"
          class="flex flex-col sm:flex-row items-stretch sm:items-end gap-2 w-full sm:w-auto"
        >
          <label class="form-control w-full sm:w-64">
            <div class="label py-0">
              <span class="label-text text-xs">{t("Search")}</span>
            </div>
            <input
              name="q"
              value={q}
              placeholder={t("Customer, ID or number")}
              class="input input-bordered input-sm"
            />
          </label>
          {/* preserve current status chosen via tags */}
          <input type="hidden" name="status" value={status} />
          <div class="flex gap-2">
            <button type="submit" class="btn btn-sm flex-1 sm:flex-none">
              {t("Apply")}
            </button>
            {(q || status) && (
              <a
                href="/invoices"
                class="btn btn-ghost btn-sm flex-1 sm:flex-none"
              >
                {t("Clear")}
              </a>
            )}
          </div>
        </form>
        <div class="join w-full sm:w-auto overflow-x-auto">
          {[
            { v: "", l: t("All") },
            { v: "draft", l: t("Draft") },
            { v: "sent", l: t("Sent") },
            { v: "paid", l: t("Paid") },
            { v: "overdue", l: t("Overdue") },
          ].map(({ v, l }) => (
            <a
              href={qsFor(v)}
              class={`btn btn-sm join-item ${
                status === v ? "btn-active" : "btn-ghost"
              }`}
            >
              {l}
            </a>
          ))}
        </div>
      </div>
      <div class="mb-3 text-xs opacity-70">
        {t("Invoices list summary", {
          visible: String(list.length),
          total: String(totalCount),
        })}
      </div>

      {/* Mobile Card View */}
      <div class="block lg:hidden space-y-3">
        {list.map((inv) => (
          <a
            href={`/invoices/${inv.id}`}
            class="card bg-base-100 border border-base-300 hover:shadow-md transition-shadow"
          >
            <div class="card-body p-4">
              <div class="flex justify-between items-start mb-2">
                <div class="flex-1">
                  <div class="font-mono text-sm font-semibold link">
                    {inv.invoiceNumber || inv.id}
                  </div>
                  <div class="text-sm mt-1">{inv.customer?.name}</div>
                </div>
                <div>{statusBadge(inv.status)}</div>
              </div>
              <div class="flex justify-between items-center text-sm pt-2 border-t border-base-300">
                <div class="opacity-70">{fmtDate(inv.issue_date)}</div>
                <div class="font-medium font-mono tabular-nums">
                  {formatInvoiceMoney(inv)}
                </div>
              </div>
            </div>
          </a>
        ))}
        {list.length === 0 && (
          <div class="card bg-base-100 border border-base-300">
            <div class="card-body text-center py-10 text-sm opacity-70">
              {q || status
                ? (
                  <span>
                    {t("No invoices match your filters.")}{" "}
                    <a href="/invoices" class="link">{t("Clear filters")}</a>
                  </span>
                )
                : (
                  <span>
                    {t("No invoices yet.")}{" "}
                    <a href="/invoices/new" class="link">
                      {t("Create your first invoice")}
                    </a>
                    {"."}
                  </span>
                )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div class="hidden lg:block overflow-x-auto rounded-box bg-base-100 border border-base-300">
        <table class="table table-sm w-full text-sm">
          <thead class="bg-base-200 text-base-content">
            <tr class="font-medium">
              <th class="w-[22%]">{t("Invoice #")}</th>
              <th>{t("Customer")}</th>
              <th class="w-[16%]">{t("Date")}</th>
              <th class="w-[14%]">{t("Status")}</th>
              <th class="w-[16%] text-right">{t("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((inv) => (
              <tr class="hover">
                <td class="cell-id">
                  <a class="link font-mono" href={`/invoices/${inv.id}`}>
                    {inv.invoiceNumber || inv.id}
                  </a>
                </td>
                <td class="cell-customer">{inv.customer?.name}</td>
                <td class="cell-date">{fmtDate(inv.issue_date)}</td>
                <td class="cell-status">{statusBadge(inv.status)}</td>
                <td class="cell-total text-right font-medium font-mono tabular-nums">
                  {formatInvoiceMoney(inv)}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} class="text-center py-10 text-sm opacity-70">
                  {q || status
                    ? (
                      <span>
                        {t("No invoices match your filters.")}{" "}
                        <a href="/invoices" class="link">
                          {t("Clear filters")}
                        </a>
                      </span>
                    )
                    : (
                      <span>
                        {t("No invoices yet.")}{" "}
                        <a href="/invoices/new" class="link">
                          {t("Create your first invoice")}
                        </a>
                        {"."}
                      </span>
                    )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
