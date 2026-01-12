import { PageProps } from "fresh";
import { Layout } from "../components/Layout.tsx";
import { backendGet, getAuthHeaderFromCookie } from "../utils/backend.ts";
import { renderPage } from "../utils/render.tsx";
import { useTranslations } from "../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type Invoice = {
  id: string;
  invoiceNumber: string;
  customer?: { name?: string };
  issueDate?: string | Date;
  updatedAt?: string | Date;
  currency?: string;
  status: "draft" | "sent" | "paid" | "overdue";
  total?: number;
};

type Data = {
  authed: boolean;
  error?: string;
  counts?: { invoices: number; customers: number };
  money?: {
    billed: number;
    paid: number;
    outstanding: number;
    currency: string;
  };
  status?: { draft: number; sent: number; paid: number; overdue: number };
  recent?: Invoice[];
  version?: string;
  dateFormat?: string;
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
      const [invoices, customers, settings] = await Promise.all([
        backendGet("/api/v1/invoices", auth) as Promise<Invoice[]>,
        backendGet("/api/v1/customers", auth) as Promise<unknown[]>,
        backendGet("/api/v1/settings", auth).catch(() => ({})) as Promise<
          Record<string, unknown>
        >,
      ]);

      const currency = (invoices[0]?.currency as string) || "USD";
      const dateFormat = String(settings.dateFormat || "YYYY-MM-DD");
      const billed = invoices.reduce((sum, i) => sum + (i.total || 0), 0);
      const paid = invoices.filter((i) => i.status === "paid").reduce(
        (s, i) => s + (i.total || 0),
        0,
      );
      const outstanding = invoices.filter((i) =>
        i.status === "sent" || i.status === "overdue"
      ).reduce((s, i) => s + (i.total || 0), 0);
      const status = {
        draft: invoices.filter((i) => i.status === "draft").length,
        sent: invoices.filter((i) => i.status === "sent").length,
        paid: invoices.filter((i) => i.status === "paid").length,
        overdue: invoices.filter((i) => i.status === "overdue").length,
      };

      const recent = invoices
        .slice()
        .sort((a, b) =>
          new Date(b.updatedAt || b.issueDate || 0).getTime() -
          new Date(a.updatedAt || a.issueDate || 0).getTime()
        )
        .slice(0, 5);

      // Read version from VERSION file (container or repo root)
      let version = "unknown";
      const possiblePaths = [
        "/app/VERSION",
        Deno.cwd() + "/../VERSION",
        Deno.cwd() + "/VERSION",
      ];
      for (const path of possiblePaths) {
        try {
          version = await Deno.readTextFile(path).then((v) => v.trim());
          break;
        } catch {
          // Ignore and try next path
        }
      }

      return renderPage(ctx, Dashboard, {
        authed: true,
        counts: {
          invoices: invoices.length,
          customers: customers.length,
        },
        money: { billed, paid, outstanding, currency },
        status,
        recent,
        version,
        dateFormat,
      });
    } catch (e) {
      return renderPage(ctx, Dashboard, { authed: true, error: String(e) });
    }
  },
};

export default function Dashboard(props: PageProps<Data>) {
  const { t, numberFormat } = useTranslations();
  const fmtMoney = (n: number) => {
    const cur = props.data.money?.currency || "USD";
    try {
      const locale = numberFormat === "period" ? "de-DE" : "en-US";
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: cur,
      }).format(n || 0);
    } catch {
      return `${cur} ${Number(n || 0).toFixed(2)}`;
    }
  };

  return (
    <Layout authed={props.data.authed} path={new URL(props.url).pathname}>
      <div class="mb-4">
        <h1 class="text-2xl font-semibold">{t("Dashboard")}</h1>
      </div>

      {props.data.error && (
        <div class="alert alert-error mb-4">
          <span>{props.data.error}</span>
        </div>
      )}

      {props.data.counts && (
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">{t("Invoices")}</div>
              <div class="text-2xl sm:text-3xl font-extrabold">
                {props.data.counts.invoices}
              </div>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">{t("Customers")}</div>
              <div class="text-2xl sm:text-3xl font-extrabold">
                {props.data.counts.customers}
              </div>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">
                {t("Open Invoices")}
              </div>
              <div class="text-2xl sm:text-3xl font-extrabold">
                {(props.data.status?.sent || 0) +
                  (props.data.status?.overdue || 0)}
              </div>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">{t("Version")}</div>
              <div class="text-2xl sm:text-3xl font-extrabold">
                {props.data.version}
              </div>
            </div>
          </div>
        </div>
      )}

      {props.data.money && (
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">
                {t("Total Billed")}
              </div>
              <div class="text-xl sm:text-2xl font-bold">
                {fmtMoney(props.data.money.billed)}
              </div>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">
                {t("Outstanding")}
              </div>
              <div class="text-xl sm:text-2xl font-bold">
                {fmtMoney(props.data.money.outstanding)}
              </div>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">{t("Paid")}</div>
              <div class="text-xl sm:text-2xl font-bold">
                {fmtMoney(props.data.money.paid)}
              </div>
            </div>
          </div>
        </div>
      )}

      {props.data.status && (
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">{t("Draft")}</div>
              <div class="text-lg sm:text-xl font-semibold">
                {props.data.status.draft}
              </div>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">{t("Sent")}</div>
              <div class="text-lg sm:text-xl font-semibold">
                {props.data.status.sent}
              </div>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">{t("Paid")}</div>
              <div class="text-lg sm:text-xl font-semibold">
                {props.data.status.paid}
              </div>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-box">
            <div class="card-body p-4">
              <div class="text-xs sm:text-sm opacity-70">{t("Overdue")}</div>
              <div
                class={`text-lg sm:text-xl font-semibold ${
                  props.data.status?.overdue > 0 ? "text-error" : ""
                }`}
              >
                {props.data.status.overdue}
              </div>
            </div>
          </div>
        </div>
      )}

      {props.data.recent && props.data.recent.length > 0 && (
        <div class="bg-base-100 border border-base-300 rounded-box overflow-hidden">
          <div class="p-4 border-b border-base-300 flex items-center justify-between">
            <h2 class="font-semibold">{t("Recent Invoices")}</h2>
            <a href="/invoices" class="btn btn-sm btn-ghost">
              {t("View all")}
            </a>
          </div>

          {/* Mobile Card View */}
          <div class="block lg:hidden p-3 space-y-3">
            {props.data.recent.map((inv) => {
              const d = inv.issueDate ? new Date(inv.issueDate) : undefined;
              const dateFormat = props.data.dateFormat || "YYYY-MM-DD";
              let date = "";
              if (d && !isNaN(d.getTime())) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, "0");
                const day = String(d.getDate()).padStart(2, "0");
                date = dateFormat === "DD.MM.YYYY"
                  ? `${day}.${month}.${year}`
                  : `${year}-${month}-${day}`;
              }
              const badge = inv.status === "paid"
                ? "badge-success"
                : inv.status === "overdue"
                ? "badge-error"
                : inv.status === "sent"
                ? "badge-info"
                : "";
              const statusLabels: Record<string, string> = {
                draft: t("Draft"),
                sent: t("Sent"),
                paid: t("Paid"),
                overdue: t("Overdue"),
              };
              return (
                <a
                  href={`/invoices/${inv.id}`}
                  class="card bg-base-200 hover:shadow-md transition-shadow"
                >
                  <div class="card-body p-3">
                    <div class="flex justify-between items-start mb-2">
                      <div class="flex-1">
                        <div class="font-semibold text-sm">
                          {inv.invoiceNumber}
                        </div>
                        <div class="text-xs mt-1 opacity-70">
                          {inv.customer?.name || ""}
                        </div>
                      </div>
                      <span class={`badge badge-sm ${badge}`}>
                        {statusLabels[inv.status] || inv.status}
                      </span>
                    </div>
                    <div class="flex justify-between items-center text-xs pt-2 border-t border-base-300">
                      <div class="opacity-70">{date}</div>
                      <div class="font-semibold">
                        {fmtMoney(inv.total || 0)}
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>

          {/* Desktop Table View */}
          <div class="hidden lg:block overflow-x-auto">
            <table class="table table-zebra w-full text-sm">
              <thead class="bg-base-200 text-base-content">
                <tr class="text-sm font-medium">
                  <th>{t("Invoice #")}</th>
                  <th>{t("Customer")}</th>
                  <th>{t("Date")}</th>
                  <th>{t("Status")}</th>
                  <th class="text-right">{t("Total")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {props.data.recent.map((inv) => {
                  const d = inv.issueDate ? new Date(inv.issueDate) : undefined;
                  const dateFormat = props.data.dateFormat || "YYYY-MM-DD";
                  let date = "";
                  if (d && !isNaN(d.getTime())) {
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, "0");
                    const day = String(d.getDate()).padStart(2, "0");
                    date = dateFormat === "DD.MM.YYYY"
                      ? `${day}.${month}.${year}`
                      : `${year}-${month}-${day}`;
                  }
                  const badge = inv.status === "paid"
                    ? "badge-success"
                    : inv.status === "overdue"
                    ? "badge-error"
                    : inv.status === "sent"
                    ? "badge-info"
                    : "";
                  const statusLabels: Record<string, string> = {
                    draft: t("Draft"),
                    sent: t("Sent"),
                    paid: t("Paid"),
                    overdue: t("Overdue"),
                  };
                  return (
                    <tr class="hover" key={inv.id}>
                      <td class="font-semibold">{inv.invoiceNumber}</td>
                      <td>{inv.customer?.name || ""}</td>
                      <td>{date}</td>
                      <td>
                        <span class={`badge ${badge}`}>
                          {statusLabels[inv.status] || inv.status}
                        </span>
                      </td>
                      <td class="text-right">{fmtMoney(inv.total || 0)}</td>
                      <td class="text-right">
                        <a
                          class="btn btn-ghost btn-sm"
                          href={`/invoices/${inv.id}`}
                        >
                          {t("Open")}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}
