import { PageProps } from "fresh";
import { Layout } from "../../components/Layout.tsx";
import { LuUserPlus } from "../../components/icons.tsx";
import { backendGet, getAuthHeaderFromCookie } from "../../utils/backend.ts";
import { renderPage } from "../../utils/render.tsx";
import { useTranslations } from "../../i18n/context.tsx";
import { Handlers } from "fresh/compat";

type Customer = { id: string; name?: string; email?: string };
type Data = { authed: boolean; customers?: Customer[]; error?: string };

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
      const customers = await backendGet(
        "/api/v1/customers",
        auth,
      ) as Customer[];
      return renderPage(ctx, Customers, { authed: true, customers });
    } catch (e) {
      return renderPage(ctx, Customers, { authed: true, error: String(e) });
    }
  },
};

export default function Customers(props: PageProps<Data>) {
  const list = props.data.customers ?? [];
  const { t } = useTranslations();
  return (
    <Layout authed={props.data.authed} path={new URL(props.url).pathname}>
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 class="text-2xl font-semibold">{t("Customers")}</h1>
        <a
          href="/customers/new"
          class="btn btn-sm btn-primary w-full sm:w-auto"
        >
          <LuUserPlus size={16} />
          {t("New Customer")}
        </a>
      </div>
      {props.data.error && (
        <div class="alert alert-error mb-3">
          <span>{props.data.error}</span>
        </div>
      )}

      {/* Mobile Card View */}
      <div class="block md:hidden space-y-3">
        {list.map((c) => (
          <a
            href={`/customers/${c.id}`}
            class="card bg-base-100 border border-base-300 hover:shadow-md transition-shadow"
          >
            <div class="card-body p-4">
              <div class="font-semibold link">{c.name || c.id}</div>
              {c.email && <div class="text-sm opacity-70 mt-1">{c.email}</div>}
            </div>
          </a>
        ))}
        {list.length === 0 && (
          <div class="card bg-base-100 border border-base-300">
            <div class="card-body text-center py-10 text-sm opacity-70">
              <span>
                {t("No customers yet.")}{" "}
                <a href="/customers/new" class="link">
                  {t("Create your first customer")}
                </a>
                {"."}
              </span>
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
              <th>{t("Email")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr class="hover">
                <td>
                  <a class="link" href={`/customers/${c.id}`}>
                    {c.name || c.id}
                  </a>
                </td>
                <td class="opacity-70">{c.email || ""}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={2} class="text-center py-10 text-sm opacity-70">
                  <span>
                    {t("No customers yet.")}{" "}
                    <a href="/customers/new" class="link">
                      {t("Create your first customer")}
                    </a>
                    {"."}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
