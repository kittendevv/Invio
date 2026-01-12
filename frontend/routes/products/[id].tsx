/** Product detail page with edit/delete actions */
import { PageProps } from "fresh";
import { Layout } from "../../components/Layout.tsx";
import { LuPencil, LuTrash2 } from "../../components/icons.tsx";
import ConfirmOnSubmit from "../../islands/ConfirmOnSubmit.tsx";
import {
  backendDelete,
  backendGet,
  backendPost,
  getAuthHeaderFromCookie,
} from "../../utils/backend.ts";
import { renderPage } from "../../utils/render.tsx";
import { useTranslations } from "../../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type Product = {
  id: string;
  name: string;
  description?: string;
  unitPrice: number;
  sku?: string;
  unit?: string;
  category?: string;
  taxDefinitionId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
type TaxDefinition = {
  id: string;
  code?: string;
  name?: string;
  percent: number;
};
type Data = {
  authed: boolean;
  product?: Product;
  taxDefinition?: TaxDefinition;
  usedInInvoices?: boolean;
  error?: string;
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
      const [product, usage, settings] = await Promise.all([
        backendGet(`/api/v1/products/${id}`, auth) as Promise<Product>,
        backendGet(`/api/v1/products/${id}/usage`, auth) as Promise<
          { usedInInvoices: boolean }
        >,
        backendGet("/api/v1/settings", auth) as Promise<
          Record<string, unknown>
        >,
      ]);

      let taxDefinition: TaxDefinition | undefined;
      if (product.taxDefinitionId) {
        try {
          taxDefinition = await backendGet(
            `/api/v1/tax-definitions/${product.taxDefinitionId}`,
            auth,
          ) as TaxDefinition;
        } catch {
          // Tax definition may have been deleted
        }
      }

      return renderPage(ctx, ProductDetail, {
        authed: true,
        product,
        taxDefinition,
        usedInInvoices: usage.usedInInvoices,
        settings,
      });
    } catch (e) {
      return renderPage(ctx, ProductDetail, { authed: true, error: String(e) });
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
        await backendDelete(`/api/v1/products/${id}`, auth);
        return new Response(null, {
          status: 303,
          headers: { Location: "/products" },
        });
      } catch (e) {
        return renderPage(ctx, ProductDetail, { authed: true, error: String(e) });
      }
    }

    if (intent === "reactivate") {
      try {
        await backendPost(`/api/v1/products/${id}/reactivate`, auth, {});
        return new Response(null, {
          status: 303,
          headers: { Location: `/products/${id}` },
        });
      } catch (e) {
        return renderPage(ctx, ProductDetail, { authed: true, error: String(e) });
      }
    }

    return new Response("Unsupported action", { status: 400 });
  },
};

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function ProductDetail(props: PageProps<Data>) {
  const p = props.data.product;
  const { t } = useTranslations();
  const settings = props.data.settings ?? {};
  const currency = String(settings.currency || "USD");
  const demoMode = settings.demoMode === "true";
  const usedInInvoices = props.data.usedInInvoices ?? false;
  const taxDef = props.data.taxDefinition;

  const unitLabels: Record<string, string> = {
    piece: t("Piece"),
    hour: t("Hour"),
    day: t("Day"),
    kg: t("Kilogram"),
    m: t("Meter"),
    lump_sum: t("Lump Sum"),
  };

  const categoryLabels: Record<string, string> = {
    service: t("Service"),
    goods: t("Goods"),
    subscription: t("Subscription"),
    other: t("Other"),
  };

  return (
    <Layout authed={props.data.authed} path={new URL(props.url).pathname}>
      <ConfirmOnSubmit />
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <div>
          <h1 class="text-2xl font-semibold">
            {t("Product")} {p?.name || p?.id}
          </h1>
          {p && !p.isActive && (
            <span class="badge badge-ghost mt-1">{t("Inactive")}</span>
          )}
        </div>
        {p && (
          <div class="flex gap-2 flex-wrap">
            <a href={`/products/${p.id}/edit`} class="btn btn-sm">
              <LuPencil size={16} />
              {t("Edit")}
            </a>
            {!p.isActive && (
              <form method="post">
                <input type="hidden" name="intent" value="reactivate" />
                <button
                  type="submit"
                  class="btn btn-sm btn-success"
                  disabled={demoMode}
                >
                  {t("Reactivate")}
                </button>
              </form>
            )}
            {p.isActive && (
              <form
                method="post"
                data-confirm={usedInInvoices
                  ? t(
                    "This product is used in invoices. Deleting will deactivate it. Continue?",
                  )
                  : t("Delete this product? This cannot be undone.")}
              >
                <input type="hidden" name="intent" value="delete" />
                <button
                  type="submit"
                  class="btn btn-sm btn-outline btn-error"
                  disabled={demoMode}
                >
                  <LuTrash2 size={16} />
                  {usedInInvoices ? t("Deactivate") : t("Delete")}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {props.data.error && (
        <div class="alert alert-error mb-3">
          <span>{props.data.error}</span>
        </div>
      )}

      {p && (
        <div class="card bg-base-100 border border-base-300">
          <div class="card-body space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div class="text-sm opacity-70">{t("Name")}</div>
                <div class="font-medium">{p.name}</div>
              </div>

              <div>
                <div class="text-sm opacity-70">{t("Unit Price")}</div>
                <div class="font-mono text-lg">
                  {formatCurrency(p.unitPrice, currency)}
                </div>
              </div>

              {p.sku && (
                <div>
                  <div class="text-sm opacity-70">{t("SKU")}</div>
                  <div class="font-mono">{p.sku}</div>
                </div>
              )}

              {p.unit && (
                <div>
                  <div class="text-sm opacity-70">{t("Unit")}</div>
                  <div>{unitLabels[p.unit] || p.unit}</div>
                </div>
              )}

              {p.category && (
                <div>
                  <div class="text-sm opacity-70">{t("Category")}</div>
                  <div>{categoryLabels[p.category] || p.category}</div>
                </div>
              )}

              {taxDef && (
                <div>
                  <div class="text-sm opacity-70">{t("Tax Definition")}</div>
                  <div>
                    {taxDef.name || taxDef.code || `${taxDef.percent}%`}{" "}
                    ({taxDef.percent}%)
                  </div>
                </div>
              )}
            </div>

            {p.description && (
              <div>
                <div class="text-sm opacity-70">{t("Description")}</div>
                <div class="whitespace-pre-wrap">{p.description}</div>
              </div>
            )}

            {usedInInvoices && (
              <div class="alert alert-info">
                <span>{t("This product is used in existing invoices.")}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
