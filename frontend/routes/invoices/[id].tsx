import { PageProps } from "fresh";
import { Layout } from "../../components/Layout.tsx";
import ConfirmOnSubmit from "../../islands/ConfirmOnSubmit.tsx";
import CopyPublicLink from "../../islands/CopyPublicLink.tsx";
import {
  LuCheck,
  LuCheckCircle,
  LuCopy,
  LuDownload,
  LuExternalLink,
  LuFileCode2,
  LuFileText,
  LuMoreHorizontal,
  LuPencil,
  LuSend,
  LuShieldOff,
  LuTrash2,
  LuUpload,
} from "../../components/icons.tsx";
import { formatMoney, getNumberFormat } from "../../utils/format.ts";
import {
  backendDelete,
  backendGet,
  backendPost,
  backendPut,
  getAuthHeaderFromCookie,
} from "../../utils/backend.ts";
import { renderPage } from "../../utils/render.tsx";
import { useTranslations } from "../../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type Invoice = {
  id: string;
  invoiceNumber?: string;
  customer?: {
    name?: string;
    email?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    countryCode?: string;
  };
  items?: { description: string }[];
  currency?: string;
  subtotal?: number;
  taxAmount?: number;
  discountAmount?: number;
  total?: number;
  issueDate?: string | Date;
  dueDate?: string | Date;
  paymentTerms?: string;
  status?: "draft" | "sent" | "paid" | "overdue";
  shareToken?: string;
  taxRate?: number;
  pricesIncludeTax?: boolean;
  roundingMode?: string;
  taxes?: Array<{ percent: number; taxableAmount: number; taxAmount: number }>;
};
type Data = {
  authed: boolean;
  invoice?: Invoice;
  error?: string;
  showPublishedBanner?: boolean;
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
    const { id } = ctx.params as { id: string };
    try {
      const [invoice, settings] = await Promise.all([
        backendGet(`/api/v1/invoices/${id}`, auth) as Promise<Invoice>,
        backendGet("/api/v1/settings", auth).catch(() => ({})) as Promise<
          Record<string, unknown>
        >,
      ]);
      const url = new URL(req.url);
      const showPublishedBanner = url.searchParams.get("published") === "1";
      const dateFormat = String(settings.dateFormat || "YYYY-MM-DD");
      return renderPage(ctx, InvoiceDetail, {
        authed: true,
        invoice,
        showPublishedBanner,
        dateFormat,
        settings,
      });
    } catch (e) {
      return renderPage(ctx, InvoiceDetail, { authed: true, error: String(e) });
    }
  },
  async POST(ctx) {
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
    const { id } = ctx.params as { id: string };
    const form = await req.formData();
    const intent = String(form.get("intent") || "");
    if (intent === "delete") {
      try {
        await backendDelete(`/api/v1/invoices/${id}`, auth);
        return new Response(null, {
          status: 303,
          headers: { Location: "/invoices" },
        });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    if (intent === "publish") {
      try {
        await backendPost(
          `/api/v1/invoices/${id}/publish`,
          auth,
          {},
        );
        return new Response(null, {
          status: 303,
          headers: { Location: `/invoices/${id}?published=1` },
        });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    if (intent === "mark-sent") {
      try {
        await backendPut(`/api/v1/invoices/${id}`, auth, { status: "sent" });
        return new Response(null, {
          status: 303,
          headers: { Location: `/invoices/${id}` },
        });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    if (intent === "mark-paid") {
      try {
        await backendPut(`/api/v1/invoices/${id}`, auth, { status: "paid" });
        return new Response(null, {
          status: 303,
          headers: { Location: `/invoices/${id}` },
        });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    if (intent === "duplicate") {
      try {
        const copy = await backendPost(
          `/api/v1/invoices/${id}/duplicate`,
          auth,
          {},
        );
        const newId = (copy && copy.id) ? String(copy.id) : null;
        if (!newId) throw new Error("Failed to duplicate invoice");
        return new Response(null, {
          status: 303,
          headers: { Location: `/invoices/${newId}/edit` },
        });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    if (intent === "unpublish") {
      try {
        await backendPost(`/api/v1/invoices/${id}/unpublish`, auth, {});
        return new Response(null, {
          status: 303,
          headers: { Location: `/invoices/${id}` },
        });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    return new Response("Unsupported action", { status: 400 });
  },
};

export default function InvoiceDetail(props: PageProps<Data>) {
  const { t } = useTranslations();
  const inv = props.data.invoice;
  const currency = (inv?.currency as string) || "USD";
  const dateFormat = props.data.dateFormat || "YYYY-MM-DD";
  const numberFormat = getNumberFormat(props.data.settings);
  const taxLabel = String(
    (props.data.settings?.taxLabel as string) || t("Tax"),
  );
  const fmtMoney = (v?: number) => formatMoney(v, currency, numberFormat);
  const fmtDate = (d?: string | Date) => {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(dt.getTime())) return "";
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    if (dateFormat === "DD.MM.YYYY") {
      return `${day}.${month}.${year}`;
    }
    return `${year}-${month}-${day}`;
  };
  const isOverdue = (() => {
    if (!inv) return false;
    if (inv.status === "paid") return false;
    const due = inv.dueDate ? new Date(inv.dueDate as string) : null;
    if (!due) return false;
    const today = new Date();
    // normalize to dates
    const dd = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const td = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return dd < td;
  })();
  return (
    <Layout authed={props.data.authed} path={new URL(props.url).pathname}>
      <ConfirmOnSubmit />
      {props.data.showPublishedBanner && props.data.invoice?.shareToken && (
        <div class="alert alert-success mb-4 shadow">
          <LuCheckCircle size={20} />
          <div class="flex-1">
            <div class="font-medium">{t("Invoice published")}</div>
            <div class="text-sm opacity-80 break-all">
              {t("Public link")}:{" "}
              <a
                id="public-link-url"
                class="link"
                href={`/public/invoices/${props.data.invoice.shareToken}`}
                target="_blank"
              >
                {new URL(`${props.url}`).origin}/public/invoices/{props.data
                  .invoice.shareToken}
              </a>
            </div>
          </div>
          <div class="flex gap-2">
            <a
              class="btn btn-xs btn-ghost"
              target="_blank"
              href={`/public/invoices/${props.data.invoice.shareToken}`}
            >
              {t("Open")}
            </a>
            <button id="copy-public-link" type="button" class="btn btn-xs">
              {t("Copy link")}
            </button>
            <a
              class="btn btn-xs btn-primary"
              href={`/public/invoices/${props.data.invoice.shareToken}/pdf`}
              target="_blank"
            >
              {t("Download PDF")}
            </a>
          </div>
          <CopyPublicLink />
        </div>
      )}
      {/* Removed address warning banner per request */}
      <div class="flex items-center justify-between mb-4 gap-2">
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-semibold">
            {t("Invoice #")} {inv?.invoiceNumber || inv?.id}
          </h1>
          {inv?.status && (
            <span
              class={`badge ${
                inv.status === "paid"
                  ? "badge-success"
                  : inv.status === "overdue"
                  ? "badge-error"
                  : inv.status === "sent"
                  ? "badge-info"
                  : ""
              }`}
            >
              {isOverdue && inv?.status !== "paid" ? t("Overdue") : t(
                inv?.status === "draft"
                  ? "Draft"
                  : inv?.status === "sent"
                  ? "Sent"
                  : inv?.status === "paid"
                  ? "Paid"
                  : "Overdue",
              )}
            </span>
          )}
        </div>
        {inv && (
          <div class="flex items-center gap-2">
            {(inv.status === "draft" && !isOverdue) && (
              <a href={`/invoices/${inv.id}/edit`} class="btn btn-sm">
                <LuPencil size={16} />
                {t("Edit")}
              </a>
            )}
            {/* Contextual primary action */}
            {inv.status === "draft" && (
              <form method="post">
                <input type="hidden" name="intent" value="publish" />
                <button
                  type="submit"
                  class="btn btn-sm btn-success"
                  title={t("Make public and mark as sent")}
                >
                  <LuUpload size={16} />
                  {t("Publish")}
                </button>
              </form>
            )}
            {(inv.status === "sent" || inv.status === "overdue") && (
              <form method="post">
                <input type="hidden" name="intent" value="mark-paid" />
                <button
                  type="submit"
                  class="btn btn-sm btn-primary"
                  title={t("Mark as Paid")}
                >
                  <LuCheck size={16} />
                  {t("Mark as Paid")}
                </button>
              </form>
            )}
            {/* Overflow menu for secondary actions */}
            <div class="dropdown dropdown-end">
              <div tabIndex={0} role="button" class="btn btn-ghost btn-sm">
                <LuMoreHorizontal size={16} />
                {t("More")}
              </div>
              <ul
                tabIndex={0}
                class="menu menu-sm dropdown-content bg-base-100 rounded-box z-[1] mt-2 w-56 p-2 shadow"
              >
                <li>
                  <button
                    type="submit"
                    form={`inv-${inv.id}-duplicate`}
                    class="flex items-center gap-2"
                  >
                    <LuCopy size={16} />
                    {t("Duplicate")}
                  </button>
                </li>
                <li>
                  <a
                    href={`/invoices/${inv.id}/xml`}
                    target="_blank"
                    title={t(
                      "Download XML (uses default profile from Settings)",
                    )}
                    class="flex items-center gap-2"
                  >
                    <LuFileText size={16} />
                    {t("Download XML")}
                  </a>
                </li>
                {inv.status !== "draft" && (
                  <li>
                    <button
                      type="submit"
                      form={`inv-${inv.id}-unpublish`}
                      class="flex items-center gap-2"
                    >
                      <LuShieldOff size={16} />
                      {t("Unpublish")}
                    </button>
                  </li>
                )}
                {inv.status !== "sent" && inv.status !== "paid" && (
                  <li>
                    <button
                      type="submit"
                      form={`inv-${inv.id}-mark-sent`}
                      class="flex items-center gap-2"
                    >
                      <LuSend size={16} />
                      {t("Mark as Sent")}
                    </button>
                  </li>
                )}
                {inv.status && inv.status !== "draft" && inv.shareToken && (
                  <li>
                    <a
                      href={`/public/invoices/${inv.shareToken}`}
                      target="_blank"
                      class="flex items-center gap-2"
                    >
                      <LuExternalLink size={16} />
                      {t("View public link")}
                    </a>
                  </li>
                )}
                <li>
                  <button
                    type="submit"
                    form={`inv-${inv.id}-delete`}
                    class="flex items-center gap-2 text-error"
                  >
                    <LuTrash2 size={16} />
                    {t("Delete")}
                  </button>
                </li>
              </ul>
            </div>
            {/* Hidden forms for menu actions to keep li > button structure for DaisyUI */}
            <form id={`inv-${inv.id}-duplicate`} method="post" class="hidden">
              <input type="hidden" name="intent" value="duplicate" />
            </form>
            {inv.status !== "draft" && (
              <form id={`inv-${inv.id}-unpublish`} method="post" class="hidden">
                <input type="hidden" name="intent" value="unpublish" />
              </form>
            )}
            {inv.status !== "sent" && inv.status !== "paid" && (
              <form id={`inv-${inv.id}-mark-sent`} method="post" class="hidden">
                <input type="hidden" name="intent" value="mark-sent" />
              </form>
            )}
            <form
              id={`inv-${inv.id}-delete`}
              method="post"
              class="hidden"
              data-confirm={t("Delete this invoice? This cannot be undone.")}
            >
              <input type="hidden" name="intent" value="delete" />
            </form>
          </div>
        )}
      </div>
      {props.data.error && (
        <div class="alert alert-error mb-3">
          <span>{props.data.error}</span>
        </div>
      )}
      {inv && (
        <div class="space-y-2">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span class="opacity-70">{t("Customer")}:</span>{" "}
              {inv.customer?.name}
            </div>
            <div>
              {inv.taxes && inv.taxes.length > 0 && (
                <div class="pt-2">
                  <div class="font-medium mb-1">{t("Tax Summary")}</div>
                  <div class="overflow-x-auto">
                    <table class="table table-xs w-auto">
                      <thead>
                        <tr>
                          <th class="text-left">{t("Rate")}</th>
                          <th class="text-right">{t("Taxable")}</th>
                          <th class="text-right">{t("Tax")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.taxes.map((tax) => (
                          <tr>
                            <td>{taxLabel} {tax.percent}%</td>
                            <td class="text-right">
                              {fmtMoney(tax.taxableAmount)}
                            </td>
                            <td class="text-right">
                              {fmtMoney(tax.taxAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td class="text-right font-medium" colspan={2}>
                            {t("Tax Total")}
                          </td>
                          <td class="text-right font-medium">
                            {fmtMoney(inv.taxAmount)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
              <span class="opacity-70">{t("Email")}:</span>{" "}
              {inv.customer?.email}
            </div>
            <div class="sm:col-span-2">
              <span class="opacity-70">{t("Address")}:</span> {(() => {
                const line1 = (inv.customer?.address || "").trim();
                const line2 = [
                  (inv.customer?.postalCode || "").trim(),
                  (inv.customer?.city || "").trim(),
                ].filter(Boolean).join(" ");
                const line3 = (inv.customer?.countryCode || "").trim();
                const lines = [line1, line2, line3].filter(Boolean);
                return lines.length > 0 ? lines.join(" · ") : "";
              })()}
            </div>
            <div>
              <span class="opacity-70">{t("Issue Date")}:</span>{" "}
              {fmtDate(inv.issueDate)}
            </div>
            <div>
              <span class="opacity-70">{t("Due Date")}:</span>{" "}
              {fmtDate(inv.dueDate)}{" "}
              {isOverdue && inv.status !== "paid" && (
                <span class="badge badge-error ml-2">{t("Overdue")}</span>
              )}
            </div>
            <div>
              <span class="opacity-70">{t("Subtotal")}:</span>{" "}
              {fmtMoney(inv.subtotal)}
            </div>
            <div>
              <span class="opacity-70">{t("Tax")}:</span>{" "}
              {fmtMoney(inv.taxAmount)}
            </div>
            <div class="text-xs opacity-70">
              {typeof inv.taxRate === "number"
                ? `${t("Tax rate")}: ${inv.taxRate}%`
                : ""}
              {typeof inv.pricesIncludeTax === "boolean"
                ? ` · ${t("Prices include tax")}: ${
                  inv.pricesIncludeTax ? t("Yes") : t("No")
                }`
                : ""}
              {inv.roundingMode
                ? ` · ${t("Rounding")}: ${
                  inv.roundingMode === "line"
                    ? t("Round per line")
                    : t("Round on totals")
                }`
                : ""}
              {(() => {
                const mode = (inv.taxes && inv.taxes.length)
                  ? "line"
                  : "invoice";
                return ` · ${t("Tax mode")}: ${
                  mode === "line" ? t("Per line") : t("Invoice total")
                }`;
              })()}
            </div>
            <div>
              <span class="opacity-70">{t("Discount")}:</span>{" "}
              {fmtMoney(inv.discountAmount)}
            </div>
            <div>
              <span class="opacity-70">{t("Total")}:</span>{" "}
              <span class="font-medium">{fmtMoney(inv.total)}</span>
            </div>
          </div>
          {inv.paymentTerms && (
            <div>
              <span class="opacity-70">{t("Payment Terms")}:</span>{" "}
              {inv.paymentTerms}
            </div>
          )}
          {inv.items && inv.items.length > 0 && (
            <div class="opacity-60 text-xs">
              {t("{{count}} item(s)", { count: inv.items.length })}
            </div>
          )}
          <div class="pt-4 flex gap-2 items-center flex-wrap">
            <a
              class="btn btn-sm btn-ghost"
              href={`/invoices/${inv.id}/html`}
              target="_blank"
            >
              <LuFileCode2 size={16} />
              {t("View HTML")}
            </a>
            <a
              class="btn btn-sm btn-primary"
              href={`/invoices/${inv.id}/pdf`}
            >
              <LuDownload size={16} />
              {t("Download PDF")}
            </a>
            {/* Public share link (visible when published i.e., not draft) */}
            {inv.status && inv.status !== "draft" && inv.shareToken && (
              <a
                class="btn btn-sm btn-outline"
                href={`/public/invoices/${inv.shareToken}`}
                target="_blank"
              >
                <LuExternalLink size={16} />
                {t("View public link")}
              </a>
            )}
          </div>
        </div>
      )}
      {/* islands above handle confirm + copy link */}
    </Layout>
  );
}
