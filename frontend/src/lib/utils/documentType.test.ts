import { describe, expect, test } from "bun:test";
import { isCreditNote, signedTotal } from "./documentType";

describe("documentType", () => {
  test("credit notes count negatively", () => {
    expect(signedTotal({ documentType: "credit_note", total: 120 })).toBe(-120);
  });
  test("invoices and legacy rows without a type count positively", () => {
    expect(signedTotal({ documentType: "invoice", total: 50 })).toBe(50);
    expect(signedTotal({ total: 50 })).toBe(50);
    expect(isCreditNote({ total: 50 })).toBe(false);
  });
  test("missing totals count as zero", () => {
    expect(signedTotal(null)).toBe(0);
    expect(signedTotal({ documentType: "credit_note" })).toBe(0);
  });
});
