import { describe, expect, test } from "bun:test";
import { dashboardMoney } from "./dashboardMoney";

const invoices = [
  { status: "draft", total: 50 },
  { status: "sent", total: 100 },
  { status: "overdue", total: 20 },
  { status: "paid", total: 200 },
  { status: "complete", total: 30 },
  { status: "voided", total: 400 },
];

describe("dashboardMoney", () => {
  test("paid and outstanding by status", () => {
    const m = dashboardMoney(invoices);
    expect(m.paid).toBe(230);
    expect(m.outstanding).toBe(120);
  });

  test("billed leaves out drafts and voided invoices", () => {
    expect(dashboardMoney(invoices).billed).toBe(350);
  });

  test("a voided invoice is not billed", () => {
    expect(dashboardMoney([{ status: "voided", total: 400 }]).billed).toBe(0);
  });

  test("no invoices", () => {
    expect(dashboardMoney([])).toEqual({ billed: 0, paid: 0, outstanding: 0 });
  });
});
