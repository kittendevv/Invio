export type StatsInvoice = {
  id: string;
  customerId?: string;
  customer?: { name?: string; countryCode?: string };
  issueDate?: string | Date;
  status?: string;
  total?: number;
  items?: StatsInvoiceItem[];
};

export type StatsInvoiceItem = {
  productId?: string;
  name?: string;
  quantity?: number;
  lineTotal?: number;
};

export type MonthlySales = {
  /** First day of the month, YYYY-MM */
  month: string;
  total: number;
  count: number;
};

export type CountrySales = { code: string; total: number; count: number };
export type CustomerSales = {
  id: string;
  name: string;
  total: number;
  count: number;
};

export type ProductSales = {
  /** Product id, or empty for free-text items that aren't linked to a product */
  id: string;
  name: string;
  quantity: number;
  /** Sum of line totals (before invoice-level discounts) */
  total: number;
  /** Number of invoices containing the product */
  count: number;
};

export type WeekdaySales = {
  /** 0 = Monday … 6 = Sunday */
  day: number;
  total: number;
  count: number;
};

export type SalesStats = {
  total: number;
  monthly: MonthlySales[];
  countries: CountrySales[];
  /** Sales whose customer has no country set */
  unknownCountry: { total: number; count: number };
  customers: CustomerSales[];
  products: ProductSales[];
  /** Sales per weekday of the issue date, highest total first */
  weekdays: WeekdaySales[];
};

// Drafts aren't issued yet and voided invoices were cancelled, so neither counts as a sale.
const SALE_STATUSES = new Set(["sent", "paid", "complete", "overdue"]);

export function isSale(inv: StatsInvoice): boolean {
  return SALE_STATUSES.has(inv.status || "");
}

function issueMonth(inv: StatsInvoice): string | null {
  if (!inv.issueDate) return null;
  const s =
    typeof inv.issueDate === "string"
      ? inv.issueDate
      : inv.issueDate.toISOString();
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
}

/** Weekday of the issue date, 0 = Monday … 6 = Sunday. */
export function issueWeekday(inv: StatsInvoice): number | null {
  if (!inv.issueDate) return null;
  const s =
    typeof inv.issueDate === "string"
      ? inv.issueDate
      : inv.issueDate.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  // Use the calendar date as written; parsing with a time zone could shift the day.
  const sunday0 = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  ).getUTCDay();
  return (sunday0 + 6) % 7;
}

export function invoiceYear(inv: StatsInvoice): number | null {
  const m = issueMonth(inv);
  return m ? Number(m.slice(0, 4)) : null;
}

/** Years that have at least one invoice, newest first. */
export function availableYears(invoices: StatsInvoice[]): number[] {
  const years = new Set<number>();
  for (const inv of invoices) {
    const y = invoiceYear(inv);
    if (y) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

/** Inclusive list of YYYY-MM keys from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Aggregates sales for a year (or all time when `year` is null). With a year
 * the monthly series always has 12 entries; for all time it spans the first
 * to the last month with a sale.
 */
export function computeSalesStats(
  invoices: StatsInvoice[],
  year: number | null,
): SalesStats {
  const sales = invoices.filter(
    (inv) =>
      isSale(inv) &&
      issueMonth(inv) &&
      (year === null || invoiceYear(inv) === year),
  );

  const byMonth = new Map<string, MonthlySales>();
  const byCountry = new Map<string, CountrySales>();
  const byCustomer = new Map<string, CustomerSales>();
  const byProduct = new Map<string, ProductSales>();
  const byWeekday = new Map<number, WeekdaySales>();
  const unknownCountry = { total: 0, count: 0 };
  let total = 0;

  for (const inv of sales) {
    const amount = inv.total || 0;
    total += amount;

    const month = issueMonth(inv)!;
    const m = byMonth.get(month) || { month, total: 0, count: 0 };
    m.total += amount;
    m.count++;
    byMonth.set(month, m);

    const code = (inv.customer?.countryCode || "").trim().toUpperCase();
    if (code) {
      const c = byCountry.get(code) || { code, total: 0, count: 0 };
      c.total += amount;
      c.count++;
      byCountry.set(code, c);
    } else {
      unknownCountry.total += amount;
      unknownCountry.count++;
    }

    const customerKey = inv.customerId || inv.customer?.name || "";
    if (customerKey) {
      const c = byCustomer.get(customerKey) || {
        id: inv.customerId || "",
        name: inv.customer?.name || "",
        total: 0,
        count: 0,
      };
      c.total += amount;
      c.count++;
      byCustomer.set(customerKey, c);
    }

    const day = issueWeekday(inv);
    if (day !== null) {
      const d = byWeekday.get(day) || { day, total: 0, count: 0 };
      d.total += amount;
      d.count++;
      byWeekday.set(day, d);
    }

    // Free-text items are grouped by their description.
    const seen = new Set<string>();
    for (const item of inv.items || []) {
      const name = (item.name || "").trim();
      const key = item.productId ? `id:${item.productId}` : `name:${name}`;
      if (!item.productId && !name) continue;
      const p = byProduct.get(key) || {
        id: item.productId || "",
        name,
        quantity: 0,
        total: 0,
        count: 0,
      };
      p.quantity += item.quantity || 0;
      p.total += item.lineTotal || 0;
      if (!seen.has(key)) {
        p.count++;
        seen.add(key);
      }
      byProduct.set(key, p);
    }
  }

  let months: string[];
  if (year !== null) {
    months = monthRange(`${year}-01`, `${year}-12`);
  } else if (byMonth.size) {
    const keys = [...byMonth.keys()].sort();
    months = monthRange(keys[0], keys[keys.length - 1]);
  } else {
    months = [];
  }

  const byTotal = (a: { total: number }, b: { total: number }) =>
    b.total - a.total;

  return {
    total,
    monthly: months.map(
      (month) => byMonth.get(month) || { month, total: 0, count: 0 },
    ),
    countries: [...byCountry.values()].sort(byTotal),
    unknownCountry,
    customers: [...byCustomer.values()].sort(byTotal),
    products: [...byProduct.values()].sort(byTotal),
    weekdays: [...byWeekday.values()].sort(
      (a, b) => b.total - a.total || a.day - b.day,
    ),
  };
}

/** Localized weekday name, 0 = Monday … 6 = Sunday. */
export function weekdayName(day: number, locale?: string): string {
  // 2024-01-01 was a Monday.
  const date = new Date(Date.UTC(2024, 0, 1 + day));
  try {
    return new Intl.DateTimeFormat([locale || "en", "en"], {
      weekday: "long",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day] || "";
  }
}

const regionNames = new Map<string, Intl.DisplayNames | null>();

/** Localized country name for an ISO alpha-2 code; falls back to the code. */
export function countryName(code: string, locale?: string): string {
  const key = locale || "en";
  if (!regionNames.has(key)) {
    try {
      regionNames.set(
        key,
        new Intl.DisplayNames([key, "en"], { type: "region" }),
      );
    } catch {
      regionNames.set(key, null);
    }
  }
  try {
    return regionNames.get(key)?.of(code) || code;
  } catch {
    return code;
  }
}
