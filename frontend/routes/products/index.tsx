/** Products list page with search, status filter, and category filter */
import { PageProps } from "fresh";
import { Layout } from "../../components/Layout.tsx";
import { LuPackagePlus } from "../../components/icons.tsx";
import { backendGet, getAuthHeaderFromCookie } from "../../utils/backend.ts";
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
  isActive: boolean;
};
type ProductCategory = { id: string; code: string; name: string };
type Data = {
  authed: boolean;
  products?: Product[];
  categories?: ProductCategory[];
  error?: string;
  settings?: Record<string, unknown>;
  q?: string;
  status?: string;
  category?: string;
  totalCount?: number;
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
      const category = (url.searchParams.get("category") || "").trim();

      const [productsAll, categoriesAll, settings] = await Promise.all([
        backendGet("/api/v1/products?includeInactive=true", auth) as Promise<
          Product[]
        >,
        backendGet("/api/v1/product-categories", auth) as Promise<
          ProductCategory[]
        >,
        backendGet("/api/v1/settings", auth) as Promise<
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
      const categoryLower = category.toLowerCase();

      const products = productsAll.filter((p) => {
        // Status filter: active/inactive
        const isActiveStr = p.isActive ? "active" : "inactive";
        const okStatus = !statusLower || isActiveStr === statusLower;

        // Category filter
        const okCategory = !categoryLower || norm(p.category) === categoryLower;

        if (!qLower) return okStatus && okCategory;

        // Text search: name, SKU, description
        const name = norm(p.name);
        const sku = norm(p.sku);
        const desc = norm(p.description);
        const okText = name.includes(qLower) || sku.includes(qLower) ||
          desc.includes(qLower);

        return okStatus && okCategory && okText;
      });

      return renderPage(ctx, Products, {
        authed: true,
        products,
        categories: categoriesAll,
        settings,
        q,
        status,
        category,
        totalCount: productsAll.length,
      });
    } catch (e) {
      return renderPage(ctx, Products, { authed: true, error: String(e) });
    }
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

export default function Products(props: PageProps<Data>) {
  const list = props.data.products ?? [];
  const settings = props.data.settings ?? {};
  const currency = String(settings.currency || "USD");
  const { t } = useTranslations();

  const q = props.data.q ?? "";
  const status = props.data.status ?? "";
  const category = props.data.category ?? "";
  const totalCount = props.data.totalCount ?? list.length;
  const hasFilters = !!(q || status || category);

  const categories = props.data.categories ?? [];

  const qsForStatus = (newStatus: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (newStatus) p.set("status", newStatus);
    if (category) p.set("category", category);
    const str = p.toString();
    return str ? `?${str}` : "/products";
  };

  const qsForCategory = (newCategory: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (newCategory) p.set("category", newCategory);
    const str = p.toString();
    return str ? `?${str}` : "/products";
  };

  return (
    <Layout authed={props.data.authed} path={new URL(props.url).pathname}>
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 class="text-2xl font-semibold">{t("Products")}</h1>
        <a href="/products/new" class="btn btn-sm btn-primary w-full sm:w-auto">
          <LuPackagePlus size={16} />
          {t("New Product")}
        </a>
      </div>
      {props.data.error && (
        <div class="alert alert-error mb-3">
          <span>{props.data.error}</span>
        </div>
      )}

      {/* Search and Filter */}
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
              placeholder={t("Name, SKU or description")}
              class="input input-bordered input-sm"
            />
          </label>
          {/* preserve current filters */}
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="category" value={category} />
          <div class="flex gap-2">
            <button type="submit" class="btn btn-sm flex-1 sm:flex-none">
              {t("Apply")}
            </button>
            {hasFilters && (
              <a
                href="/products"
                class="btn btn-ghost btn-sm flex-1 sm:flex-none"
              >
                {t("Clear")}
              </a>
            )}
          </div>
        </form>
        <div class="flex flex-wrap gap-2">
          <div class="join overflow-x-auto">
            {[
              { v: "", l: t("All") },
              { v: "active", l: t("Active") },
              { v: "inactive", l: t("Inactive") },
            ].map(({ v, l }) => (
              <a
                href={qsForStatus(v)}
                class={`btn btn-sm join-item ${
                  status === v ? "btn-active" : "btn-ghost"
                }`}
              >
                {l}
              </a>
            ))}
          </div>
          <select
            class="select select-bordered select-sm"
            value={category}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              window.location.href = qsForCategory(val);
            }}
          >
            <option value="">{t("All Categories")}</option>
            {categories.map((c) => <option value={c.code}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div class="mb-3 text-xs opacity-70">
        {t("Products list summary", {
          visible: String(list.length),
          total: String(totalCount),
        })}
      </div>

      {/* Mobile Card View */}
      <div class="block md:hidden space-y-3">
        {list.map((p) => (
          <a
            href={`/products/${p.id}`}
            class={`card bg-base-100 border border-base-300 hover:shadow-md transition-shadow ${
              !p.isActive ? "opacity-60" : ""
            }`}
          >
            <div class="card-body p-4">
              <div class="flex justify-between items-start">
                <div>
                  <div class="font-semibold link">{p.name}</div>
                  {p.sku && <div class="text-xs opacity-50">{p.sku}</div>}
                </div>
                <div class="text-right">
                  <div class="font-mono">
                    {formatCurrency(p.unitPrice, currency)}
                  </div>
                  {!p.isActive && (
                    <span class="badge badge-ghost badge-sm">
                      {t("Inactive")}
                    </span>
                  )}
                </div>
              </div>
              {p.description && (
                <div class="text-sm opacity-70 mt-1 line-clamp-2">
                  {p.description}
                </div>
              )}
            </div>
          </a>
        ))}
        {list.length === 0 && (
          <div class="card bg-base-100 border border-base-300">
            <div class="card-body text-center py-10 text-sm opacity-70">
              {hasFilters
                ? (
                  <span>
                    {t("No products match your filters.")}{" "}
                    <a href="/products" class="link">{t("Clear filters")}</a>
                  </span>
                )
                : (
                  <span>
                    {t("No products yet.")}{" "}
                    <a href="/products/new" class="link">
                      {t("Create your first product")}
                    </a>
                    {"."}
                  </span>
                )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div class="hidden md:block overflow-x-auto rounded-box bg-base-100 border border-base-300">
        <table class="table table-zebra w-full text-sm">
          <thead class="bg-base-200 text-base-content">
            <tr class="font-medium">
              <th>{t("Name")}</th>
              <th>{t("SKU")}</th>
              <th>{t("Unit Price")}</th>
              <th>{t("Unit")}</th>
              <th>{t("Category")}</th>
              <th>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr class={`hover ${!p.isActive ? "opacity-60" : ""}`}>
                <td>
                  <a class="link" href={`/products/${p.id}`}>
                    {p.name}
                  </a>
                </td>
                <td class="opacity-70 font-mono text-xs">{p.sku || "-"}</td>
                <td class="font-mono">
                  {formatCurrency(p.unitPrice, currency)}
                </td>
                <td class="opacity-70">{p.unit || "-"}</td>
                <td class="opacity-70">{p.category || "-"}</td>
                <td>
                  {p.isActive
                    ? (
                      <span class="badge badge-success badge-sm">
                        {t("Active")}
                      </span>
                    )
                    : (
                      <span class="badge badge-ghost badge-sm">
                        {t("Inactive")}
                      </span>
                    )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} class="text-center py-10 text-sm opacity-70">
                  {hasFilters
                    ? (
                      <span>
                        {t("No products match your filters.")}{" "}
                        <a href="/products" class="link">
                          {t("Clear filters")}
                        </a>
                      </span>
                    )
                    : (
                      <span>
                        {t("No products yet.")}{" "}
                        <a href="/products/new" class="link">
                          {t("Create your first product")}
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
