import { getEnv } from "./env.ts";

export interface OidcConfig {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  autoProvision: boolean;
}

export function getOidcConfig(): OidcConfig {
  return {
    enabled: (getEnv("OIDC_ENABLED", "false") || "false").toLowerCase() === "true",
    issuerUrl: (getEnv("OIDC_ISSUER_URL", "") || "").replace(/\/$/, ""),
    clientId: getEnv("OIDC_CLIENT_ID", "") || "",
    clientSecret: getEnv("OIDC_CLIENT_SECRET", "") || "",
    redirectUri: getEnv("OIDC_REDIRECT_URI", "") || "",
    autoProvision: (getEnv("OIDC_AUTO_PROVISION", "false") || "false").toLowerCase() === "true",
  };
}

export interface OidcClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
}

// ── Discovery document ─────────────────────────────────────────────────────

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discoveryCache: DiscoveryDocument | null = null;
let discoveryCacheTime = 0;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

async function getDiscovery(): Promise<DiscoveryDocument> {
  const now = Date.now();
  if (discoveryCache && now - discoveryCacheTime < DISCOVERY_TTL_MS) {
    return discoveryCache;
  }
  const { issuerUrl } = getOidcConfig();
  if (!issuerUrl) throw new Error("OIDC_ISSUER_URL is not configured");
  const resp = await fetch(`${issuerUrl}/.well-known/openid-configuration`);
  if (!resp.ok) throw new Error(`OIDC discovery failed: ${resp.status}`);
  discoveryCache = (await resp.json()) as DiscoveryDocument;
  discoveryCacheTime = now;
  return discoveryCache;
}

// ── JWKS cache ─────────────────────────────────────────────────────────────

let jwksCache: JsonWebKey[] | null = null;
let jwksCacheTime = 0;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(jwksUri: string): Promise<JsonWebKey[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCacheTime < JWKS_TTL_MS) return jwksCache;
  const resp = await fetch(jwksUri);
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
  const body = (await resp.json()) as { keys: JsonWebKey[] };
  jwksCache = body.keys;
  jwksCacheTime = now;
  return jwksCache;
}

// ── State / nonce store ────────────────────────────────────────────────────

interface OidcState {
  nonce: string;
  createdAt: number;
}

const stateStore = new Map<string, OidcState>();
const STATE_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [key, val] of stateStore.entries()) {
    if (val.createdAt < cutoff) stateStore.delete(key);
  }
}, 5 * 60 * 1000);

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Public: build authorization URL ───────────────────────────────────────

export async function buildAuthorizationUrl(): Promise<string> {
  const config = getOidcConfig();
  if (!config.clientId) throw new Error("OIDC_CLIENT_ID is not configured");
  if (!config.redirectUri) throw new Error("OIDC_REDIRECT_URI is not configured");

  const discovery = await getDiscovery();
  const state = randomHex(16);
  const nonce = randomHex(16);
  stateStore.set(state, { nonce, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid email profile",
    state,
    nonce,
  });

  return `${discovery.authorization_endpoint}?${params}`;
}

// ── Public: exchange code + verify ID token ────────────────────────────────

export async function exchangeAndVerify(
  code: string,
  state: string,
): Promise<OidcClaims> {
  const stateEntry = stateStore.get(state);
  if (!stateEntry || Date.now() - stateEntry.createdAt > STATE_TTL_MS) {
    stateStore.delete(state);
    throw new Error("Invalid or expired OIDC state");
  }
  const { nonce } = stateEntry;
  stateStore.delete(state);

  const config = getOidcConfig();
  const discovery = await getDiscovery();

  const tokenResp = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    throw new Error(`Token exchange failed: ${tokenResp.status} ${body}`);
  }

  const tokens = (await tokenResp.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("No id_token in token response");

  return verifyIdToken(tokens.id_token, discovery.jwks_uri, config.clientId, discovery.issuer, nonce);
}

// ── ID token verification (RS256) ─────────────────────────────────────────

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlDecode(b64url: string): string {
  return new TextDecoder().decode(b64urlToBytes(b64url));
}

async function verifyIdToken(
  idToken: string,
  jwksUri: string,
  clientId: string,
  expectedIssuer: string,
  expectedNonce: string,
): Promise<OidcClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(b64urlDecode(headerB64)) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256") {
    throw new Error(`Unsupported ID token algorithm: ${header.alg}`);
  }

  const jwks = await getJwks(jwksUri);
  const jwk = jwks.find(
    (k) =>
      k.kid === header.kid &&
      (k as Record<string, unknown>).use !== "enc" &&
      ((k as Record<string, unknown>).alg === "RS256" ||
        (k as Record<string, unknown>).kty === "RSA"),
  );
  if (!jwk) throw new Error(`No matching JWK for kid=${header.kid}`);

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64urlToBytes(sigB64);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    signedData,
  );
  if (!valid) throw new Error("ID token signature verification failed");

  const payload = JSON.parse(b64urlDecode(payloadB64)) as Record<string, unknown>;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    throw new Error("ID token expired");
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error(`Issuer mismatch: got ${payload.iss}`);
  }
  const aud = payload.aud;
  const audOk =
    aud === clientId || (Array.isArray(aud) && aud.includes(clientId));
  if (!audOk) throw new Error("ID token audience mismatch");
  if (payload.nonce !== expectedNonce) {
    throw new Error("ID token nonce mismatch");
  }

  return {
    sub: String(payload.sub),
    email: payload.email ? String(payload.email) : undefined,
    preferred_username: payload.preferred_username
      ? String(payload.preferred_username)
      : undefined,
    name: payload.name ? String(payload.name) : undefined,
  };
}
