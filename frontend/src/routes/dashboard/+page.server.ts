import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { backendGet, SESSION_COOKIE } from "$lib/backend";
import { getVersion } from "$lib/version";
import { dashboardMoney } from "$lib/utils/dashboardMoney";
import {
  availableYears,
  computeSalesStats,
  invoiceYear,
  type StatsInvoiceItem,
} from "$lib/dashboardStats";

type Invoice = {
  id: string;
  invoiceNumber: string;
  customerId?: string;
  customer?: { name?: string; countryCode?: string };
  issueDate?: string | Date;
  updatedAt?: string | Date;
  currency?: string;
  status?: "draft" | "sent" | "complete" | "paid" | "overdue" | "voided";
  total?: number;
  documentType?: string;
  items?: StatsInvoiceItem[];
};

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
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

  // ?year=2025 limits the dashboard to invoices issued that year; anything else means all time.
  const yearParam = url.searchParams.get("year");
  const year =
    yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  try {
    const [allInvoices, customers, settings] = await Promise.all([
      canViewInvoices
        ? (backendGet("/api/v1/invoices?includeItems=1", auth) as Promise<
            Invoice[]
          >)
        : Promise.resolve([] as Invoice[]),
      canViewCustomers
        ? (backendGet("/api/v1/customers", auth) as Promise<unknown[]>)
        : Promise.resolve([] as unknown[]),
      backendGet("/api/v1/settings", auth).catch(() => ({})) as Promise<
        Record<string, unknown>
      >,
    ]);

    const years = availableYears(allInvoices);
    const invoices =
      year === null
        ? allInvoices
        : allInvoices.filter((i) => invoiceYear(i) === year);
    const sales = computeSalesStats(invoices, year);

    const currency = (allInvoices[0]?.currency as string) || "USD";
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
    // Invoices still waiting for payment (an issued credit note is not one)
    const openInvoices = invoices.filter(
      (i) =>
        (i.status === "sent" || i.status === "overdue") &&
        i.documentType !== "credit_note",
    ).length;

    const recent = allInvoices
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
      openInvoices,
      recent,
      sales,
      years,
      year,
      version,
      dateFormat,
    };
  } catch (err) {
    return { error: String(err) };
  }
};
