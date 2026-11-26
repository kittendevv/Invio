// Headers the backend reads to identify the client. Requests from the
// frontend arrive on loopback, so the backend trusts these from us. They must
// never pass through from the browser.
const CLIENT_ADDRESS_HEADERS = ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"];

/**
 * Copy browser request headers for a backend call, dropping hop-specific
 * headers and replacing client-address headers with `clientAddress`.
 */
export function buildBackendHeaders(
  incoming: Headers,
  clientAddress: string,
): Headers {
  const headers = new Headers();
  for (const [k, v] of incoming.entries()) {
    const lowerK = k.toLowerCase();
    if (lowerK === "host") continue;
    if (lowerK === "content-length") continue;
    if (lowerK === "accept-encoding") continue; // Prevent backend compression
    if (CLIENT_ADDRESS_HEADERS.includes(lowerK)) continue;
    headers.set(k, v);
  }
  headers.set("x-forwarded-for", clientAddress);
  return headers;
}
