import { PageProps } from "fresh";
import { Layout } from "../../components/Layout.tsx";
import { LuPencil, LuTrash2 } from "../../components/icons.tsx";
import ConfirmOnSubmit from "../../islands/ConfirmOnSubmit.tsx";
import {
  backendDelete,
  backendGet,
  getAuthHeaderFromCookie,
} from "../../utils/backend.ts";
import { renderPage } from "../../utils/render.tsx";
import { useTranslations } from "../../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type Customer = {
  id: string;
  name?: string;
  contactName?: string;
  email?: string;
  address?: string;
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
      return renderPage(ctx, CustomerDetail, { authed: true, customer });
    } catch (e) {
      return renderPage(ctx, CustomerDetail, { authed: true, error: String(e) });
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
        await backendDelete(`/api/v1/customers/${id}`, auth);
        return new Response(null, {
          status: 303,
          headers: { Location: "/customers" },
        });
      } catch (_e) {
        // Redirect to an informational page when deletion is blocked (e.g., existing invoices)
        return new Response(null, {
          status: 303,
          headers: { Location: `/customers/${id}/cannot-delete` },
        });
      }
    }
    return new Response("Unsupported action", { status: 400 });
  },
};

export default function CustomerDetail(props: PageProps<Data>) {
  const { t } = useTranslations();
  const c = props.data.customer;
  return (
    <Layout authed={props.data.authed} path={new URL(props.url).pathname}>
      <ConfirmOnSubmit />
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-semibold">
          {t("Customer")} {c?.name || c?.id}
        </h1>
        {c && (
          <div class="flex gap-2">
            <a href={`/customers/${c.id}/edit`} class="btn btn-sm">
              <LuPencil size={16} />
              {t("Edit")}
            </a>
            <form
              method="post"
              data-confirm={t("Delete this customer? This cannot be undone.")}
            >
              <input type="hidden" name="intent" value="delete" />
              <button type="submit" class="btn btn-sm btn-outline btn-error">
                <LuTrash2 size={16} />
                {t("Delete")}
              </button>
            </form>
          </div>
        )}
      </div>
      {props.data.error && (
        <div class="alert alert-error mb-3">
          <span>{props.data.error}</span>
        </div>
      )}
      {c && (
        <div class="space-y-2">
          {c.contactName && (
            <div>
              <span class="opacity-70">{t("Contact Name")}:</span>{" "}
              {c.contactName}
            </div>
          )}
          {c.email && (
            <div>
              <span class="opacity-70">{t("Email")}:</span> {c.email}
            </div>
          )}
          {c.address && (
            <div>
              <span class="opacity-70">{t("Address")}:</span> {c.address}
            </div>
          )}
          {(c.city || c.postalCode) && (
            <div>
              <span class="opacity-70">{t("City")}/{t("Postal Code")}:</span>
              {" "}
              {c.city || ""} {c.postalCode ? `(${c.postalCode})` : ""}
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
