import { isInternalAddress, parseIPv6 } from "./ipRanges.ts";

function assertEquals(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, received ${a}`);
}

Deno.test("parseIPv6 expands compressed and dotted forms", () => {
  assertEquals(parseIPv6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assertEquals(parseIPv6("::"), [0, 0, 0, 0, 0, 0, 0, 0]);
  assertEquals(parseIPv6("fe80::1"), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  assertEquals(
    parseIPv6("::ffff:127.0.0.1"),
    [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1],
  );
  assertEquals(
    parseIPv6("2001:db8:0:0:0:0:2:1"),
    [0x2001, 0xdb8, 0, 0, 0, 0, 2, 1],
  );
  for (const bad of ["1::2::3", "12345::", "1:2:3:4:5:6:7:8:9", "g::1", "1.2.3.4", "1:2"]) {
    assertEquals(parseIPv6(bad), null, bad);
  }
});

// Hosts as URL.hostname returns them, i.e. after WHATWG normalization
// (that is how the guard sees them).
const hostname = (u: string) => new URL(`https://${u}/`).hostname;

Deno.test("internal addresses are rejected however they are written", () => {
  const internal = [
    // IPv4, including shorthand/hex/decimal spellings URL normalizes
    "127.0.0.1", "127.1", "0x7f.1", "2130706433", "0.0.0.0", "10.1.2.3",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "192.0.0.8", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    // IPv6 loopback/unspecified and IPv4-compatible
    "[::1]", "[::]", "[0:0:0:0:0:0:0:1]", "[::127.0.0.1]", "[::a00:1]",
    // IPv4-mapped
    "[::ffff:127.0.0.1]", "[::ffff:a9fe:a9fe]", "[::ffff:10.0.0.1]",
    // NAT64 (the hextet form is what URL produces) and local-use NAT64
    "[64:ff9b::127.0.0.1]", "[64:ff9b::7f00:1]", "[64:ff9b::a00:1]",
    "[64:ff9b::a9fe:a9fe]", "[64:ff9b:1::1]",
    // 6to4 of internal IPv4
    "[2002:7f00:1::]", "[2002:a00:1::1]",
    // Unique local, link-local, site-local, multicast
    "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "[febf::1]", "[fec0::1]",
    "[ff02::1]",
  ];
  for (const host of internal) {
    assertEquals(isInternalAddress(hostname(host)), true, host);
  }
});

Deno.test("public addresses and names pass the literal check", () => {
  const external = [
    "1.1.1.1", "8.8.8.8", "100.63.255.255", "100.128.0.1", "172.32.0.1",
    "192.169.0.1", "[2606:4700:4700::1111]", "[64:ff9b::808:808]",
    "[2002:808:808::]", "[::ffff:8.8.8.8]",
    // Names are checked by DNS resolution, not here
    "example.com", "raw.githubusercontent.com",
  ];
  for (const host of external) {
    assertEquals(isInternalAddress(hostname(host)), false, host);
  }
});
