import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { backendGet, SESSION_COOKIE } from "$lib/backend";
import { getVersion } from "$lib/version";
import { dashboardMoney } from "$lib/utils/dashboardMoney";

type Invoice = {
  id: string;
  invoiceNumber: string;
  customer?: { name?: string };
  issueDate?: string | Date;
  updatedAt?: string | Date;
  currency?: string;
  status?: "draft" | "sent" | "complete" | "paid" | "overdue" | "voided";
  total?: number;
};

export const load: PageServerLoad = async ({ locals, cookies }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  const token = cookies.get(SESSION_COOKIE);
  const auth = token ? `Bearer ${token}` : "";

  const user = locals.user;
  const canViewInvoices =
    user.isAdmin ||
    user.permissions?.some(
      (p) => p.resource === "invoices" && p.action === "read",
    );
  const canViewCustomers =
    user.isAdmin ||
    user.permissions?.some(
      (p) => p.resource === "customers" && p.action === "read",
    );

  try {
    const [invoices, customers, settings] = await Promise.all([
      canViewInvoices
        ? (backendGet("/api/v1/invoices", auth) as Promise<Invoice[]>)
        : Promise.resolve([] as Invoice[]),
      canViewCustomers
        ? (backendGet("/api/v1/customers", auth) as Promise<unknown[]>)
        : Promise.resolve([] as unknown[]),
      backendGet("/api/v1/settings", auth).catch(() => ({})) as Promise<
        Record<string, unknown>
      >,
    ]);

    const currency = (invoices[0]?.currency as string) || "USD";
    const dateFormat = String(settings.dateFormat || "YYYY-MM-DD");
    const { billed, paid, outstanding } = dashboardMoney(invoices);
    const status = {
      draft: invoices.filter((i) => i.status === "draft").length,
      sent: invoices.filter((i) => i.status === "sent").length,
      complete: invoices.filter((i) => i.status === "complete").length,
      paid: invoices.filter((i) => i.status === "paid").length,
      overdue: invoices.filter((i) => i.status === "overdue").length,
      voided: invoices.filter((i) => i.status === "voided").length,
    };

    const recent = invoices
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.issueDate || 0).getTime() -
          new Date(a.updatedAt || a.issueDate || 0).getTime(),
      )
      .slice(0, 5);

    const version = getVersion();

    return {
      counts: { invoices: invoices.length, customers: customers.length },
      money: { billed, paid, outstanding, currency },
      status,
      recent,
      version,
      dateFormat,
    };
  } catch (err) {
    return { error: String(err) };
  }
};
