import { PageProps } from "fresh";
import { Layout } from "../../../components/Layout.tsx";
import { LuAlertTriangle, LuList } from "../../../components/icons.tsx";
import { getAuthHeaderFromCookie } from "../../../utils/backend.ts";
import { renderPage } from "../../../utils/render.tsx";
import { useTranslations } from "../../../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type Data = { authed: boolean; id: string };

export const handler: Handlers<Data> = {
  GET(ctx) {
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
    return renderPage(ctx, CannotDeleteCustomer, { authed: true, id });
  },
};

export default function CannotDeleteCustomer(props: PageProps<Data>) {
  const { t } = useTranslations();
  const { id } = props.data;
  return (
    <Layout authed={props.data.authed} path={new URL(props.url).pathname} wide>
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-2xl font-semibold">{t("Cannot Delete Customer")}</h1>
          <div class="flex items-center gap-2">
            <a href={`/customers/${id}`} class="btn btn-ghost btn-sm">
              {t("Back to Customer")}
            </a>
            <a href="/invoices" class="btn btn-primary btn-sm">
              <LuList size={16} />
              {t("Go to Invoices")}
            </a>
          </div>
        </div>

        <div class="alert alert-warning">
          <LuAlertTriangle size={20} />
          <div>
            <h3 class="font-bold">{t("Customer Has Associated Invoices")}</h3>
            <div class="text-sm mt-1">
              {t("Customer has invoices warning")}
            </div>
          </div>
        </div>

        <div class="bg-base-200 rounded-box p-4">
          <h3 class="font-semibold mb-2">{t("What you need to do:")}</h3>
          <ul class="list-disc pl-5 space-y-1 text-sm">
            <li>{t("Delete or reassign all invoices for this customer")}</li>
            <li>{t("Then return to the customer page and try again")}</li>
          </ul>
        </div>
      </div>
    </Layout>
  );
}
