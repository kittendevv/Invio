/** Create new product form */
import { PageProps } from "fresh";
import { Layout } from "../../components/Layout.tsx";
import { LuPackagePlus } from "../../components/icons.tsx";
import {
  backendGet,
  backendPost,
  getAuthHeaderFromCookie,
} from "../../utils/backend.ts";
import { renderPage } from "../../utils/render.tsx";
import { useTranslations } from "../../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type TaxDefinition = {
  id: string;
  code?: string;
  name?: string;
  percent: number;
};
type ProductCategory = { id: string; code: string; name: string };
type ProductUnit = { id: string; code: string; name: string };
type Data = {
  authed: boolean;
  error?: string;
  taxDefinitions?: TaxDefinition[];
  categories?: ProductCategory[];
  units?: ProductUnit[];
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
      const [taxDefinitions, categories, units, settings] = await Promise.all([
        backendGet("/api/v1/tax-definitions", auth) as Promise<TaxDefinition[]>,
        backendGet("/api/v1/product-categories", auth) as Promise<
          ProductCategory[]
        >,
        backendGet("/api/v1/product-units", auth) as Promise<ProductUnit[]>,
        backendGet("/api/v1/settings", auth) as Promise<
          Record<string, unknown>
        >,
      ]);
      return renderPage(ctx, NewProductPage, {
        authed: true,
        taxDefinitions,
        categories,
        units,
        settings,
      });
    } catch {
      return renderPage(ctx, NewProductPage, { authed: true });
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
    const form = await req.formData();
    const name = String(form.get("name") || "");
    const description = String(form.get("description") || "");
    const unitPrice = parseFloat(String(form.get("unitPrice") || "0"));
    const sku = String(form.get("sku") || "");
    const unit = String(form.get("unit") || "");
    const category = String(form.get("category") || "");
    const taxDefinitionId = String(form.get("taxDefinitionId") || "");

    if (!name) return new Response("Name is required", { status: 400 });

    try {
      const created = await backendPost("/api/v1/products", auth, {
        name,
        description: description || undefined,
        unitPrice,
        sku: sku || undefined,
        unit: unit || undefined,
        category: category || undefined,
        taxDefinitionId: taxDefinitionId || undefined,
      }) as { id: string };
      return new Response(null, {
        status: 303,
        headers: { Location: `/products/${created.id}` },
      });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
};

export default function NewProductPage(props: PageProps<Data>) {
  const { t } = useTranslations();
  const demoMode = props.data.settings?.demoMode === "true";
  const taxDefinitions = props.data.taxDefinitions ?? [];
  const categories = props.data.categories ?? [];
  const units = props.data.units ?? [];

  return (
    <Layout
      authed={props.data.authed}
      demoMode={demoMode}
      path={new URL(props.url).pathname}
      wide
    >
      {props.data.error && (
        <div class="alert alert-error mb-3">
          <span>{props.data.error}</span>
        </div>
      )}
      <form method="post" class="space-y-4" data-writable>
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h1 class="text-2xl font-semibold">{t("Create Product")}</h1>
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <a
              href="/products"
              class="btn btn-ghost btn-sm flex-1 sm:flex-none"
            >
              {t("Cancel")}
            </a>
            <button
              type="submit"
              class="btn btn-primary flex-1 sm:flex-none"
              data-writable
            >
              <LuPackagePlus size={16} />
              {t("Create Product")}
            </button>
          </div>
        </div>

        <div class="space-y-3">
          <label class="form-control">
            <div class="label">
              <span class="label-text">
                {t("Name")} <span class="text-error">*</span>
              </span>
            </div>
            <input
              name="name"
              class="input input-bordered w-full"
              required
              data-writable
            />
          </label>

          <label class="form-control">
            <div class="label">
              <span class="label-text">{t("Description")}</span>
            </div>
            <textarea
              name="description"
              class="textarea textarea-bordered"
              rows={3}
              data-writable
            />
          </label>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="form-control">
              <div class="label">
                <span class="label-text">
                  {t("Unit Price")} <span class="text-error">*</span>
                </span>
              </div>
              <input
                type="number"
                name="unitPrice"
                step="0.01"
                min="0"
                class="input input-bordered w-full"
                required
                data-writable
              />
            </label>

            <label class="form-control">
              <div class="label">
                <span class="label-text">{t("SKU")}</span>
              </div>
              <input
                name="sku"
                class="input input-bordered w-full"
                data-writable
              />
            </label>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="form-control">
              <div class="label">
                <span class="label-text">{t("Unit")}</span>
              </div>
              <select
                name="unit"
                class="select select-bordered w-full"
                data-writable
              >
                <option value="">{t("Select unit")}</option>
                {units.map((u) => <option value={u.code}>{u.name}</option>)}
              </select>
            </label>

            <label class="form-control">
              <div class="label">
                <span class="label-text">{t("Category")}</span>
              </div>
              <select
                name="category"
                class="select select-bordered w-full"
                data-writable
              >
                <option value="">{t("Select category")}</option>
                {categories.map((c) => <option value={c.code}>{c.name}
                </option>)}
              </select>
            </label>
          </div>

          {taxDefinitions.length > 0 && (
            <label class="form-control">
              <div class="label">
                <span class="label-text">{t("Tax Definition")}</span>
              </div>
              <select
                name="taxDefinitionId"
                class="select select-bordered w-full"
                data-writable
              >
                <option value="">{t("No default tax")}</option>
                {taxDefinitions.map((tax) => (
                  <option value={tax.id}>
                    {tax.name || tax.code || `${tax.percent}%`} ({tax.percent}%)
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </form>
    </Layout>
  );
}
