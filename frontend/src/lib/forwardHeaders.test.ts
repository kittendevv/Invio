import { describe, expect, test } from "bun:test";
import { buildBackendHeaders } from "./forwardHeaders";

describe("buildBackendHeaders", () => {
  test("replaces client-supplied address headers", () => {
    const h = buildBackendHeaders(
      new Headers({
        "X-Forwarded-For": "6.6.6.6",
        "X-Real-IP": "6.6.6.6",
        "CF-Connecting-IP": "6.6.6.6",
        "content-type": "application/json",
      }),
      "203.0.113.5",
    );
    expect(h.get("x-forwarded-for")).toBe("203.0.113.5");
    expect(h.get("x-real-ip")).toBeNull();
    expect(h.get("cf-connecting-ip")).toBeNull();
    expect(h.get("content-type")).toBe("application/json");
  });

  test("drops hop-specific headers", () => {
    const h = buildBackendHeaders(
      new Headers({ host: "x", "content-length": "3", "accept-encoding": "gzip" }),
      "203.0.113.5",
    );
    expect(h.get("host")).toBeNull();
    expect(h.get("content-length")).toBeNull();
    expect(h.get("accept-encoding")).toBeNull();
  });
});
