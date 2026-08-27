import { describe, expect, test } from "bun:test";
import {
  originAllowed,
  originMatchesRequestHost,
  parseAllowedOrigins,
  isMutatingFormRequest,
} from "./csrf";

describe("originAllowed", () => {
  test("exact match", () => {
    expect(
      originAllowed("http://localhost:8000", ["http://localhost:8000"]),
    ).toBe(true);
  });

  test("hostname mismatch is denied", () => {
    expect(
      originAllowed("http://127.0.0.1:8000", ["http://localhost:8000"]),
    ).toBe(false);
  });

  test("missing origin is denied", () => {
    expect(originAllowed("", ["http://localhost:8000"])).toBe(false);
    expect(originAllowed("", ["*"])).toBe(false);
  });

  test("wildcard allows any origin", () => {
    expect(originAllowed("http://evil.example:8000", ["*"])).toBe(true);
  });

  test("glob matches Tailscale MagicDNS", () => {
    expect(
      originAllowed("http://umbrel-home.tailf2e95.ts.net:8003", [
        "http://*.ts.net:8003",
      ]),
    ).toBe(true);
  });

  test("glob rejects other hosts and ports", () => {
    expect(
      originAllowed("http://evil.example:8003", ["http://*.ts.net:8003"]),
    ).toBe(false);
    expect(
      originAllowed("http://umbrel-home.tailf2e95.ts.net:8000", [
        "http://*.ts.net:8003",
      ]),
    ).toBe(false);
  });
});

describe("parseAllowedOrigins", () => {
  test("ORIGIN only", () => {
    expect(parseAllowedOrigins("http://umbrel.local:8003", undefined)).toEqual([
      "http://umbrel.local:8003",
    ]);
  });

  test("ORIGIN plus TRUSTED_ORIGINS", () => {
    expect(
      parseAllowedOrigins(
        "http://app.local:8000",
        "http://tailscale.local:8000, http://*.ts.net:8003",
      ),
    ).toEqual([
      "http://app.local:8000",
      "http://tailscale.local:8000",
      "http://*.ts.net:8003",
    ]);
  });

  test("both env vars empty yields empty list", () => {
    expect(parseAllowedOrigins(undefined, undefined)).toEqual([]);
    expect(parseAllowedOrigins("", "")).toEqual([]);
  });
});

describe("originMatchesRequestHost", () => {
  test("matches Host including port, ignoring http vs https", () => {
    expect(
      originMatchesRequestHost("http://app.local:18000", "app.local:18000"),
    ).toBe(true);
    expect(
      originMatchesRequestHost("https://app.local:18000", "app.local:18000"),
    ).toBe(true);
  });

  test("rejects a different hostname", () => {
    expect(
      originMatchesRequestHost(
        "http://tailscale.local:18000",
        "app.local:18000",
      ),
    ).toBe(false);
  });
});

describe("isMutatingFormRequest", () => {
  test("login form POST is checked", () => {
    const request = new Request("http://localhost/login?/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(isMutatingFormRequest(request)).toBe(true);
  });

  test("GET is not checked", () => {
    const request = new Request("http://localhost/login");
    expect(isMutatingFormRequest(request)).toBe(false);
  });
});
