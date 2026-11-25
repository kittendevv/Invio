// Address checks for the SSRF guard of the remote template installer.
//
// Hosts are compared as parsed numbers, not as strings: URL.hostname
// normalizes IP literals (IPv4 shorthand/hex/decimal to dotted quads, IPv6 to
// bracketed, compressed hextets such as "[64:ff9b::7f00:1]"), so string
// prefixes miss many spellings of the same internal address.

/** Strip the square brackets URL.hostname puts around IPv6 literals. */
export function stripIpv6Brackets(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;
}

/** Parse a dotted-quad IPv4 address into 4 octets, or null. */
export function parseIPv4(addr: string): number[] | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null;
}

/** Parse an IPv6 address (without brackets or zone id) into 8 hextets, or null. */
export function parseIPv6(addr: string): number[] | null {
  if (!addr.includes(":")) return null;
  let head = addr;
  // A trailing dotted quad stands for the last two hextets
  const tail: number[] = [];
  const v4 = addr.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const o = parseIPv4(v4[2]);
    if (!o) return null;
    head = v4[1].endsWith("::") ? v4[1] : v4[1].slice(0, -1);
    tail.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const toHextets = (s: string) =>
    s === "" ? [] : s.split(":").map((h) =>
      /^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN
    );
  const left = toHextets(halves[0]);
  const right = halves.length === 2 ? toHextets(halves[1]) : [];
  const given = left.length + right.length + tail.length;
  if ([...left, ...right].some(Number.isNaN)) return null;
  if (halves.length === 1 && given !== 8) return null;
  if (halves.length === 2 && given > 7) return null;
  const zeros = new Array(8 - given).fill(0);
  return [...left, ...zeros, ...right, ...tail];
}

/** True for IPv4 addresses that must never be fetched server-side. */
export function isInternalIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 || // "this network", includes 0.0.0.0
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT (RFC 6598)
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** IPv4 address embedded in the last two hextets. */
function embeddedIPv4(h: number[]): number[] {
  return [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff];
}

/** True for IPv6 addresses that must never be fetched server-side. */
export function isInternalIPv6(h: number[]): boolean {
  const firstSixZero = h.slice(0, 6).every((x) => x === 0);
  // ::/96 covers :: (unspecified), ::1 (loopback) and the deprecated
  // IPv4-compatible addresses ::a.b.c.d
  if (firstSixZero) return true;
  // IPv4-mapped ::ffff:a.b.c.d
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return isInternalIPv4(embeddedIPv4(h));
  }
  // NAT64 well-known prefix 64:ff9b::/96 translates to the embedded IPv4
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return isInternalIPv4(embeddedIPv4(h));
  }
  // Local-use NAT64 64:ff9b:1::/48 is site-internal by definition
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return true;
  // 6to4 2002:a.b.c.d::/48
  if (h[0] === 0x2002) {
    return isInternalIPv4([h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff]);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  return false;
}

/**
 * True if `host` (a URL hostname or a resolved address) is an IP literal in
 * an internal range. Hostnames that aren't IP literals return false; they
 * are checked by resolving them.
 */
export function isInternalAddress(host: string): boolean {
  const bare = stripIpv6Brackets(host);
  const v4 = parseIPv4(bare);
  if (v4) return isInternalIPv4(v4);
  const v6 = parseIPv6(bare);
  if (v6) return isInternalIPv6(v6);
  return false;
}
