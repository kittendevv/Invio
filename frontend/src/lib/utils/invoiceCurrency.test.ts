import { describe, expect, test } from "bun:test";
import { editorCurrency } from "./invoiceCurrency";

describe("editorCurrency", () => {
  test("a saved invoice keeps its currency", () => {
    expect(editorCurrency({ currency: "USD" }, { currency: "EUR" })).toBe("USD");
  });

  test("a saved invoice keeps its currency when settings are not loaded", () => {
    // The edit page does not load settings.
    expect(editorCurrency({ currency: "CAD" }, {})).toBe("CAD");
  });

  test("a new invoice starts from the company currency", () => {
    expect(editorCurrency(null, { currency: "CAD" })).toBe("CAD");
  });

  test("EUR when neither is set", () => {
    expect(editorCurrency(null, {})).toBe("EUR");
  });
});
