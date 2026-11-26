import {
  canonicalIp,
  getClientIp,
  isRateLimited,
  recordFailedAttempt,
} from "./rateLimiter.ts";

function assertEquals(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}

const xff = (v: string) => new Headers({ "x-forwarded-for": v });

Deno.test("getClientIp uses the peer address when the peer is not trusted", () => {
  assertEquals(getClientIp(xff("1.2.3.4"), "203.0.113.9", false), "203.0.113.9");
  assertEquals(getClientIp(new Headers(), "203.0.113.9", false), "203.0.113.9");
});

Deno.test("getClientIp trusts X-Forwarded-For from loopback", () => {
  assertEquals(getClientIp(xff("198.51.100.7"), "127.0.0.1", false), "198.51.100.7");
  assertEquals(getClientIp(xff("198.51.100.7"), "::1", false), "198.51.100.7");
  assertEquals(getClientIp(xff("198.51.100.7"), "::ffff:127.0.0.1", false), "198.51.100.7");
});

Deno.test("getClientIp trusts X-Forwarded-For from any peer when configured", () => {
  assertEquals(getClientIp(xff("198.51.100.7, 10.0.0.2"), "10.0.0.2", true), "198.51.100.7");
});

Deno.test("getClientIp ignores forwarded values that are not IP addresses", () => {
  assertEquals(getClientIp(xff("not-an-ip"), "127.0.0.1", false), "127.0.0.1");
  assertEquals(getClientIp(xff("x".repeat(500)), "10.0.0.2", true), "10.0.0.2");
  assertEquals(
    getClientIp(new Headers({ "x-forwarded-for": "junk", "x-real-ip": "198.51.100.7" }), "::1", false),
    "198.51.100.7",
  );
});

Deno.test("canonicalIp gives equivalent spellings one key", () => {
  assertEquals(canonicalIp("2001:DB8::1"), "2001:db8:0:0:0:0:0:1");
  assertEquals(canonicalIp("2001:0db8:0000::0001"), "2001:db8:0:0:0:0:0:1");
  assertEquals(canonicalIp("[2001:db8::1]"), "2001:db8:0:0:0:0:0:1");
  assertEquals(canonicalIp("fe80::1%eth0"), "fe80:0:0:0:0:0:0:1");
  assertEquals(canonicalIp("::ffff:192.0.2.1"), "192.0.2.1");
  assertEquals(canonicalIp(" 192.0.2.1 "), "192.0.2.1");
  assertEquals(canonicalIp("::ffff:c000:201"), "192.0.2.1");
  assertEquals(canonicalIp("192.0.2"), null);
  assertEquals(canonicalIp("192.0.2.1%eth0"), null);
  assertEquals(canonicalIp("fe80::1%"), null);
  assertEquals(canonicalIp("unknown"), null);
});

Deno.test({
  name: "failed logins from one client do not lock out another client",
  sanitizeOps: false, // module starts a cleanup interval
  fn() {
    const attacker = getClientIp(xff("192.0.2.66"), "127.0.0.1", false);
    const victim = getClientIp(xff("192.0.2.10"), "127.0.0.1", false);
    for (let i = 0; i < 10; i++) recordFailedAttempt(attacker, `guess${i}`);

    assertEquals(isRateLimited(attacker, "someone").limited, true, "attacker");
    assertEquals(isRateLimited(victim, "alice").limited, false, "victim");
  },
});
