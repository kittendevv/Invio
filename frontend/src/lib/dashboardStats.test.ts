import { describe, expect, test } from "bun:test";
import {
  availableYears,
  computeSalesStats,
  issueWeekday,
  monthRange,
  weekdayName,
} from "./dashboardStats";

const invoices = [
  {
    id: "1",
    customerId: "a",
    customer: { name: "A", countryCode: "de" },
    issueDate: "2025-01-15",
    status: "paid",
    total: 100,
    items: [
      { productId: "p1", name: "Widget", quantity: 2, lineTotal: 60 },
      { productId: "p1", name: "Widget", quantity: 1, lineTotal: 30 },
      { name: " Shipping ", quantity: 1, lineTotal: 10 },
    ],
  },
  {
    id: "2",
    customerId: "a",
    customer: { name: "A", countryCode: "DE" },
    issueDate: "2025-03-02",
    status: "sent",
    total: 50,
    items: [{ name: "Shipping", quantity: 1, lineTotal: 50 }],
  },
  {
    id: "3",
    customerId: "b",
    customer: { name: "B", countryCode: "US" },
    issueDate: "2025-03-20",
    status: "overdue",
    total: 300,
    items: [
      { productId: "p1", name: "Widget", quantity: 10, lineTotal: 300 },
      { name: "", quantity: 1, lineTotal: 0 },
    ],
  },
  {
    id: "4",
    customerId: "c",
    customer: { name: "C" },
    issueDate: "2024-11-01",
    status: "complete",
    total: 20,
  },
  {
    id: "5",
    customerId: "b",
    customer: { name: "B", countryCode: "US" },
    issueDate: "2025-02-01",
    status: "draft",
    total: 999,
    items: [{ productId: "p2", name: "Gadget", quantity: 1, lineTotal: 999 }],
  },
  {
    id: "6",
    customerId: "b",
    customer: { name: "B", countryCode: "US" },
    issueDate: "2025-02-01",
    status: "voided",
    total: 999,
  },
];

describe("monthRange", () => {
  test("spans year boundaries inclusively", () => {
    expect(monthRange("2024-11", "2025-02")).toEqual([
      "2024-11",
      "2024-12",
      "2025-01",
      "2025-02",
    ]);
  });
});

describe("availableYears", () => {
  test("returns distinct years newest first", () => {
    expect(availableYears(invoices)).toEqual([2025, 2024]);
  });
});

describe("computeSalesStats", () => {
  test("ignores drafts and voided invoices", () => {
    const s = computeSalesStats(invoices, null);
    expect(s.total).toBe(470);
  });

  test("filters by year and always returns 12 months", () => {
    const s = computeSalesStats(invoices, 2025);
    expect(s.total).toBe(450);
    expect(s.monthly).toHaveLength(12);
    expect(s.monthly[0]).toEqual({ month: "2025-01", total: 100, count: 1 });
    expect(s.monthly[1]).toEqual({ month: "2025-02", total: 0, count: 0 });
    expect(s.monthly[2]).toEqual({ month: "2025-03", total: 350, count: 2 });
  });

  test("all time spans first to last month with sales", () => {
    const s = computeSalesStats(invoices, null);
    expect(s.monthly.map((m) => m.month)).toEqual([
      "2024-11",
      "2024-12",
      "2025-01",
      "2025-02",
      "2025-03",
    ]);
  });

  test("groups countries case-insensitively and tracks missing countries", () => {
    const s = computeSalesStats(invoices, null);
    expect(s.countries).toEqual([
      { code: "US", total: 300, count: 1 },
      { code: "DE", total: 150, count: 2 },
    ]);
    expect(s.unknownCountry).toEqual({ total: 20, count: 1 });
  });

  test("ranks customers by revenue", () => {
    const s = computeSalesStats(invoices, null);
    expect(s.customers.map((c) => [c.name, c.total])).toEqual([
      ["B", 300],
      ["A", 150],
      ["C", 20],
    ]);
  });

  test("ranks products by revenue, grouping free-text items by name", () => {
    const s = computeSalesStats(invoices, null);
    expect(s.products).toEqual([
      { id: "p1", name: "Widget", quantity: 13, total: 390, count: 2 },
      { id: "", name: "Shipping", quantity: 2, total: 60, count: 2 },
    ]);
  });

  test("ranks weekdays by revenue", () => {
    const s = computeSalesStats(invoices, null);
    expect(s.weekdays).toEqual([
      { day: 3, total: 300, count: 1 },
      { day: 2, total: 100, count: 1 },
      { day: 6, total: 50, count: 1 },
      { day: 4, total: 20, count: 1 },
    ]);
  });
});

describe("issueWeekday", () => {
  test("uses the calendar date with Monday as 0", () => {
    expect(issueWeekday({ id: "x", issueDate: "2025-01-13" })).toBe(0);
    expect(issueWeekday({ id: "x", issueDate: "2025-01-19T23:30:00Z" })).toBe(
      6,
    );
    expect(issueWeekday({ id: "x" })).toBeNull();
  });
});

describe("weekdayName", () => {
  test("localizes Monday-based days", () => {
    expect(weekdayName(0, "en")).toBe("Monday");
    expect(weekdayName(6, "de")).toBe("Sonntag");
  });
});

describe("computeSalesStats with credit notes", () => {
  const sales = [
    {
      id: "i1",
      customerId: "a",
      customer: { name: "A", countryCode: "DE" },
      issueDate: "2025-01-15",
      status: "paid",
      total: 100,
      items: [{ productId: "p1", name: "Widget", quantity: 4, lineTotal: 100 }],
    },
    {
      id: "c1",
      documentType: "credit_note",
      customerId: "a",
      customer: { name: "A", countryCode: "DE" },
      issueDate: "2025-02-03",
      status: "sent",
      total: 25,
      items: [{ productId: "p1", name: "Widget", quantity: 1, lineTotal: 25 }],
    },
  ];

  test("subtracts credit notes without counting them as sales", () => {
    const s = computeSalesStats(sales, 2025);
    expect(s.total).toBe(75);
    expect(s.monthly[0]).toEqual({ month: "2025-01", total: 100, count: 1 });
    expect(s.monthly[1]).toEqual({ month: "2025-02", total: -25, count: 0 });
    expect(s.countries).toEqual([{ code: "DE", total: 75, count: 1 }]);
    expect(s.customers).toEqual([{ id: "a", name: "A", total: 75, count: 1 }]);
    expect(s.products).toEqual([
      { id: "p1", name: "Widget", quantity: 3, total: 75, count: 1 },
    ]);
  });
});
