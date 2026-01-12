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

type Customer = {
  id: string;
  name?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  countryCode?: string;
  city?: string;
  postalCode?: string;
};
type Data = { authed: boolean; customer?: Customer; error?: string };

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
      const customer = await backendGet(
        `/api/v1/customers/${id}`,
        auth,
      ) as Customer;
      return renderPage(ctx, EditCustomerPage, { authed: true, customer });
    } catch (e) {
      return renderPage(ctx, EditCustomerPage, { authed: true, error: String(e) });
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
      contactName: String(form.get("contactName") || ""),
      email: String(form.get("email") || ""),
      phone: String(form.get("phone") || ""),
      address: String(form.get("address") || ""),
      city: String(form.get("city") || ""),
      postalCode: String(form.get("postalCode") || ""),
      taxId: String(form.get("taxId") || ""),
      countryCode: String(form.get("countryCode") || ""),
    };
    if (!payload.name) return new Response("Name is required", { status: 400 });
    try {
      await backendPut(`/api/v1/customers/${id}`, auth, payload);
      return new Response(null, {
        status: 303,
        headers: { Location: `/customers/${id}` },
      });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
};

export default function EditCustomerPage(props: PageProps<Data>) {
  const { t } = useTranslations();
  const demoMode =
    ((props.data as unknown) as { settings?: Record<string, unknown> }).settings
      ?.demoMode === "true";
  const c = props.data.customer;
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
      {c && (
        <form method="post" class="space-y-4" data-writable>
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h1 class="text-2xl font-semibold">{t("Edit Customer")}</h1>
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <a
                href={`/customers/${c.id}`}
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
                value={c.name || ""}
                class="input input-bordered w-full"
                required
                data-writable
                disabled={demoMode}
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">{t("Contact Name")}</span>
              </div>
              <input
                name="contactName"
                value={c.contactName || ""}
                class="input input-bordered w-full"
                data-writable
                disabled={demoMode}
              />
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">{t("Email")}</span>
                </div>
                <input
                  type="email"
                  name="email"
                  value={c.email || ""}
                  class="input input-bordered w-full"
                  data-writable
                  disabled={demoMode}
                />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">{t("Phone")}</span>
                </div>
                <input
                  name="phone"
                  value={c.phone || ""}
                  class="input input-bordered w-full"
                  data-writable
                  disabled={demoMode}
                />
              </label>
            </div>
            <label class="form-control">
              <div class="label">
                <span class="label-text">{t("Address")}</span>
              </div>
              <textarea
                name="address"
                class="textarea textarea-bordered"
                rows={3}
                data-writable
                disabled={demoMode}
              >
                {c.address || ""}
              </textarea>
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">{t("City")}</span>
                </div>
                <input
                  name="city"
                  value={c.city || ""}
                  class="input input-bordered w-full"
                  data-writable
                  disabled={demoMode}
                />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">{t("Postal Code")}</span>
                </div>
                <input
                  name="postalCode"
                  value={c.postalCode || ""}
                  class="input input-bordered w-full"
                  data-writable
                  disabled={demoMode}
                />
              </label>
            </div>
            <label class="form-control">
              <div class="label">
                <span class="label-text">{t("Tax ID")}</span>
              </div>
              <input
                name="taxId"
                value={c.taxId || ""}
                class="input input-bordered w-full"
                data-writable
                disabled={demoMode}
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">
                  {t("Country Code (ISO alpha-2)")}
                </span>
              </div>
              <input
                name="countryCode"
                value={c.countryCode || ""}
                class="input input-bordered w-full"
                maxlength={2}
                placeholder={t("Country code placeholder")}
                data-writable
                disabled={demoMode}
              />
            </label>
          </div>
        </form>
      )}
    </Layout>
  );
}
