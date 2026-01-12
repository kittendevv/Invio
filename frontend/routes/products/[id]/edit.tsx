/** Edit product form */
import { PageProps } from "fresh";
import { Layout } from "../../../components/Layout.tsx";
import { LuSave } from "../../../components/icons.tsx";
import {
  backendGet,
  backendPut,
  getAuthHeaderFromCookie,
} from "../../../utils/backend.ts";
import { renderPage } from "../../../utils/render.tsx";
import { useTranslations } from "../../../i18n/context.tsx";
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
};
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
  product?: Product;
  taxDefinitions?: TaxDefinition[];
  categories?: ProductCategory[];
  units?: ProductUnit[];
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
      const [product, taxDefinitions, categories, units, settings] =
        await Promise.all([
          backendGet(`/api/v1/products/${id}`, auth) as Promise<Product>,
          backendGet("/api/v1/tax-definitions", auth) as Promise<
            TaxDefinition[]
          >,
          backendGet("/api/v1/product-categories", auth) as Promise<
            ProductCategory[]
          >,
          backendGet("/api/v1/product-units", auth) as Promise<ProductUnit[]>,
          backendGet("/api/v1/settings", auth) as Promise<
            Record<string, unknown>
          >,
        ]);
      return renderPage(ctx, EditProductPage, {
        authed: true,
        product,
        taxDefinitions,
        categories,
        units,
        settings,
      });
    } catch (e) {
      return renderPage(ctx, EditProductPage, { authed: true, error: String(e) });
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
    const payload = {
      name: String(form.get("name") || ""),
      description: String(form.get("description") || "") || undefined,
      unitPrice: parseFloat(String(form.get("unitPrice") || "0")),
      sku: String(form.get("sku") || "") || undefined,
      unit: String(form.get("unit") || "") || undefined,
      category: String(form.get("category") || "") || undefined,
      taxDefinitionId: String(form.get("taxDefinitionId") || "") || undefined,
      isActive: form.get("isActive") === "true",
    };
    if (!payload.name) return new Response("Name is required", { status: 400 });
    try {
      await backendPut(`/api/v1/products/${id}`, auth, payload);
      return new Response(null, {
        status: 303,
        headers: { Location: `/products/${id}` },
      });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
};

export default function EditProductPage(props: PageProps<Data>) {
  const { t } = useTranslations();
  const demoMode = props.data.settings?.demoMode === "true";
  const p = props.data.product;
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
      {p && (
        <form method="post" class="space-y-4" data-writable>
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h1 class="text-2xl font-semibold">{t("Edit Product")}</h1>
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <a
                href={`/products/${p.id}`}
                class="btn btn-ghost btn-sm flex-1 sm:flex-none"
              >
                {t("Cancel")}
              </a>
              <button
                type="submit"
                class="btn btn-primary flex-1 sm:flex-none"
                data-writable
                disabled={demoMode}
              >
                <LuSave size={16} />
                {t("Save")}
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
                value={p.name || ""}
                class="input input-bordered w-full"
                required
                data-writable
                disabled={demoMode}
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
                disabled={demoMode}
              >
                {p.description || ""}
              </textarea>
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
                  value={p.unitPrice}
                  class="input input-bordered w-full"
                  required
                  data-writable
                  disabled={demoMode}
                />
              </label>

              <label class="form-control">
                <div class="label">
                  <span class="label-text">{t("SKU")}</span>
                </div>
                <input
                  name="sku"
                  value={p.sku || ""}
                  class="input input-bordered w-full"
                  data-writable
                  disabled={demoMode}
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
                  disabled={demoMode}
                >
                  <option value="">{t("Select unit")}</option>
                  {units.map((u) => (
                    <option value={u.code} selected={p.unit === u.code}>
                      {u.name}
                    </option>
                  ))}
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
                  disabled={demoMode}
                >
                  <option value="">{t("Select category")}</option>
                  {categories.map((c) => (
                    <option value={c.code} selected={p.category === c.code}>
                      {c.name}
                    </option>
                  ))}
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
                  disabled={demoMode}
                >
                  <option value="">{t("No default tax")}</option>
                  {taxDefinitions.map((tax) => (
                    <option
                      value={tax.id}
                      selected={p.taxDefinitionId === tax.id}
                    >
                      {tax.name || tax.code || `${tax.percent}%`}{" "}
                      ({tax.percent}%)
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label class="form-control">
              <div class="label">
                <span class="label-text">{t("Status")}</span>
              </div>
              <select
                name="isActive"
                class="select select-bordered w-full"
                data-writable
                disabled={demoMode}
              >
                <option value="true" selected={p.isActive}>
                  {t("Active")}
                </option>
                <option value="false" selected={!p.isActive}>
                  {t("Inactive")}
                </option>
              </select>
            </label>
          </div>
        </form>
      )}
    </Layout>
  );
}
