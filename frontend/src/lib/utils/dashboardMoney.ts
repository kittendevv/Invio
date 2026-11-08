type InvoiceSum = { status?: string | null; total?: number | null };

/**
 * Money figures on the dashboard. Only issued invoices count: drafts have
 * not been sent and voided invoices were cancelled, so "billed" is what is
 * still outstanding plus what has been paid.
 */
export function dashboardMoney(invoices: InvoiceSum[]): { billed: number; paid: number; outstanding: number } {
  const sum = (statuses: string[]) =>
    invoices.filter((i) => statuses.includes(i.status || "")).reduce((s, i) => s + (i.total || 0), 0);
  const paid = sum(["paid", "complete"]);
  const outstanding = sum(["sent", "overdue"]);
  return { billed: paid + outstanding, paid, outstanding };
}
