import { describe, expect, test } from "bun:test";
import { lineTaxes, lineTaxPercent, taxModeOf } from "./lineTaxes";

describe("lineTaxes", () => {
  test("per-line mode sends the line's percent", () => {
    expect(lineTaxes("line", 20)).toEqual([{ percent: 20 }]);
    expect(lineTaxes("line", "7.5")).toEqual([{ percent: 7.5 }]);
  });

  test("no taxes in invoice mode or for a 0% line", () => {
    expect(lineTaxes("invoice", 20)).toBeUndefined();
    expect(lineTaxes("line", 0)).toBeUndefined();
    expect(lineTaxes("line", "")).toBeUndefined();
  });
});

describe("taxModeOf", () => {
  test("a saved invoice with line taxes opens in per-line mode", () => {
    expect(taxModeOf([{ taxes: [] }, { taxes: [{ percent: 10 }] }])).toBe("line");
  });

  test("otherwise invoice mode", () => {
    expect(taxModeOf([{ taxes: [] }, {}])).toBe("invoice");
    expect(taxModeOf(undefined)).toBe("invoice");
  });
});

describe("lineTaxPercent", () => {
  test("takes the percent from the saved line taxes", () => {
    expect(lineTaxPercent({ taxes: [{ percent: 20 }] })).toBe(20);
    expect(lineTaxPercent({ taxes: [{ percent: 5 }, { percent: 2.5 }] })).toBe(7.5);
  });

  test("keeps the editor's own value for a line without taxes", () => {
    expect(lineTaxPercent({ taxPercent: 0 })).toBe(0);
    expect(lineTaxPercent({ taxPercent: 12 })).toBe(12);
  });
});
