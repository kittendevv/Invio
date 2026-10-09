import { describe, expect, test } from "bun:test";
import { formatDate } from "./date";

describe("formatDate", () => {
  const utcMidnight = "2026-10-09T00:00:00.000Z";

  test("YYYY-MM-DD", () => {
    expect(formatDate(utcMidnight, "YYYY-MM-DD")).toBe("2026-10-09");
  });

  test("DD.MM.YYYY", () => {
    expect(formatDate(utcMidnight, "DD.MM.YYYY")).toBe("09.10.2026");
  });

  test("defaults to YYYY-MM-DD", () => {
    expect(formatDate(new Date(utcMidnight))).toBe("2026-10-09");
  });

  test("empty and invalid input", () => {
    expect(formatDate(undefined)).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});
