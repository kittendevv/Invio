import { getDatabase } from "../database/init.ts";
import { Template, TemplateType } from "../types/index.ts";
import { resolveInDataRoot } from "../utils/dataPaths.ts";
import { generateUUID } from "../utils/uuid.ts";
import { parse as parseYaml } from "yaml";
import { dirname, isAbsolute, normalize, relative, resolve } from "std/path";
import { ZipReader } from "https://deno.land/x/zipjs@v2.7.34/index.js";
// Manifest-based installer (MVP): one HTML file + optional fonts (ignored for now)

type ManifestHTML = {
  path: string;
  url: string;
  sha256?: string;
};

type TemplateManifest = {
  schema?: number;
  id: string;
  name: string;
  version: string;
  invio: string;
  html: ManifestHTML;
  // fonts?: { path: string; url: string; sha256?: string; weight?: number; style?: string }[];
  license?: string;
  source?: { manifestUrl?: string; homepage?: string };
};

async function fetchText(url: URL): Promise<string> {
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return await res.text();
}

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

async function sha256Hex(source: Uint8Array | ArrayBuffer): Promise<string> {
  const buffer = source instanceof Uint8Array
    ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
    : source.slice(0);
  const hash = await crypto.subtle.digest("SHA-256", buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function basicHtmlSanity(html: string): void {
  const lower = html.toLowerCase();
  // Block dangerous embed containers and executable script tags.
  const bannedTags = [
    "<iframe",
    "<object",
    "<embed",
    "<script",
  ];
  for (const tag of bannedTags) {
    if (lower.includes(tag)) {
      throw new Error(`HTML contains disallowed tag: ${tag}`);
    }
  }
  // Disallow inline event handlers (attribute boundary)
  if (/(\s|<)on[a-z]+\s*=\s*['\"]/i.test(lower)) {
    throw new Error("Inline event handlers not allowed");
  }
}

function assertManifestShape(m: unknown): asserts m is TemplateManifest {
  if (!m || typeof m !== "object") {
    throw new Error("Manifest must be an object");
  }
  const r = m as Record<string, unknown>;
  for (const k of ["id", "name", "version", "invio", "html"]) {
    if (!(k in r)) throw new Error(`Manifest missing ${k}`);
  }
  const html = r.html as Record<string, unknown>;
  if (!html || typeof html.path !== "string" || typeof html.url !== "string") {
    throw new Error("html.path and html.url are required");
  }
  if (!String(html.url).startsWith("http")) {
    throw new Error("html.url must be http(s)");
  }
}

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function enforceSafeIdentifier(value: string, field: string): string {
  const trimmed = value.trim();
  if (!SAFE_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `${field} must be 1-64 characters using letters, numbers, dashes, underscores, or dots`,
    );
  }
  return trimmed;
}

function sanitizeManifestPath(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    throw new Error("html.path must not be empty");
  }
  if (isAbsolute(trimmed)) {
    throw new Error("html.path must be relative");
  }
  const unixified = trimmed.replaceAll("\\", "/");
  const normalized = normalize(unixified);
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../")) {
    throw new Error("html.path must stay within the template directory");
  }
  return normalized;
}

const FORBIDDEN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  // CGNAT / carrier-grade NAT (RFC 6598) — internal in shared-hosting envs.
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// Normalize an IPv6 literal the way URL.hostname returns it: it is wrapped in
// square brackets (e.g. "[::1]"). Strip them so range checks see the raw
// address. Returns the lower-cased address without brackets.
function stripIpv6Brackets(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    return lower.slice(1, -1);
  }
  return lower;
}

function isPrivateIPv6(hostname: string): boolean {
  const addr = stripIpv6Brackets(hostname);
  if (!addr.includes(":")) return false; // not an IPv6 literal
  // Loopback ::1 and the unspecified address ::
  if (addr === "::1" || addr === "::") return true;
  // IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1) and IPv4-compatible / NAT64 /
  // 6to4 all embed an IPv4 address — extract and re-check against IPv4 rules.
  const mappedV4 = extractEmbeddedIPv4(addr);
  if (mappedV4 && isPrivateIPv4(mappedV4)) return true;
  // Unique-local fc00::/7 (fc.. and fd..) and link-local fe80::/10.
  if (/^f[cd][0-9a-f]{0,2}:/.test(addr) || addr === "fc00" || addr === "fd00") {
    return true;
  }
  if (/^fe[89ab][0-9a-f]?:/.test(addr)) return true;
  return false;
}

// Pull an embedded IPv4 address out of IPv4-mapped/compatible/NAT64/6to4 IPv6
// forms so it can be validated against the IPv4 private ranges.
function extractEmbeddedIPv4(addr: string): string | null {
  // Dotted-quad tail, e.g. ::ffff:127.0.0.1 or 64:ff9b::127.0.0.1
  const dotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  // Hextet-encoded IPv4-mapped, e.g. ::ffff:7f00:1 -> 127.0.0.1
  const mapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // 6to4 2002:V4V4::/16 and NAT64 64:ff9b::V4V4 first two hextets after prefix.
  const sixToFour = addr.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1], 16);
    const lo = parseInt(sixToFour[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

// True if a literal/resolved IP string targets an internal range.
function isForbiddenAddress(host: string): boolean {
  const h = host.toLowerCase();
  if (FORBIDDEN_HOSTS.has(h)) return true;
  const bare = stripIpv6Brackets(h);
  if (FORBIDDEN_HOSTS.has(bare)) return true;
  if (isPrivateIPv4(bare) || isPrivateIPv6(h)) return true;
  return false;
}

async function assertSafeRemoteUrl(raw: string, field: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${field} is not a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${field} must use https`);
  }
  // 1) Reject internal targets supplied directly as host literals.
  if (isForbiddenAddress(url.hostname)) {
    throw new Error(`${field} host is not allowed`);
  }
  // 2) Resolve the hostname and reject if ANY resolved address is internal.
  //    Defeats DNS-rebinding / A-record-points-internal SSRF. If the host is
  //    already an IP literal, resolveDns is skipped (it would error).
  const bare = stripIpv6Brackets(url.hostname);
  const looksLikeIp = bare.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(bare);
  if (!looksLikeIp) {
    let addrs: string[] = [];
    for (const kind of ["A", "AAAA"] as const) {
      try {
        addrs = addrs.concat(await Deno.resolveDns(bare, kind));
      } catch {
        // No record of this type; ignore.
      }
    }
    for (const ip of addrs) {
      if (isForbiddenAddress(ip)) {
        throw new Error(`${field} resolves to a disallowed address`);
      }
    }
  }
  return url;
}

// fetch() wrapper that follows redirects MANUALLY and re-validates every hop,
// so a public host cannot 30x-redirect the request into an internal target.
async function safeFetch(url: URL, maxRedirects = 5): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      // Drain the redirect body to release the connection.
      await res.body?.cancel();
      const loc = res.headers.get("location")!;
      const next = new URL(loc, current);
      // Re-run the full guard (protocol + literal + DNS) on the next target.
      current = await assertSafeRemoteUrl(next.toString(), "redirect target");
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

export async function installTemplateFromManifest(manifestUrl: string) {
  const manifestUrlObj = await assertSafeRemoteUrl(manifestUrl, "manifest URL");
  const text = await fetchText(manifestUrlObj);
  let manifest: TemplateManifest;
  try {
    manifest = parseYaml(text) as TemplateManifest;
  } catch (_e) {
    try {
      manifest = JSON.parse(text) as TemplateManifest;
    } catch {
      throw new Error("Manifest parse failed");
    }
  }
  assertManifestShape(manifest);

  const manifestId = enforceSafeIdentifier(manifest.id, "manifest.id");
  const manifestVersion = enforceSafeIdentifier(manifest.version, "manifest.version");
  const manifestPath = sanitizeManifestPath(String(manifest.html.path));
  const htmlUrl = await assertSafeRemoteUrl(String(manifest.html.url), "manifest.html.url");

  const htmlBuf = await fetchBytes(htmlUrl);
  if (htmlBuf.byteLength > 128 * 1024) {
    throw new Error("HTML too large (>128KB)");
  }
  if (manifest.html.sha256 && manifest.html.sha256.trim()) {
    const digest = await sha256Hex(htmlBuf);
    if (digest.toLowerCase() !== manifest.html.sha256.toLowerCase()) {
      throw new Error("HTML sha256 mismatch");
    }
  }
  const html = new TextDecoder().decode(htmlBuf);
  basicHtmlSanity(html);

  const baseDir = resolveInDataRoot("templates", manifestId, manifestVersion);
  const outPath = resolve(baseDir, manifestPath);
  const rel = relative(baseDir, outPath);
  if (!rel || rel.startsWith("..")) {
    throw new Error("html.path escapes template directory");
  }

  await Deno.mkdir(dirname(outPath), { recursive: true });
  await Deno.writeTextFile(outPath, html);

  const saved = upsertTemplateWithId(manifestId, {
    name: `${manifest.name} ${manifestVersion ? `v${manifestVersion}` : ""}`
      .trim(),
    html,
    isDefault: false,
    templateType: "remote",
  });
  return saved;
}

export const getTemplates = () => {
  const db = getDatabase();
  const results = db.query(
    "SELECT id, name, html, is_default, template_type, created_at FROM templates ORDER BY created_at DESC",
  );
  return results.map((row: unknown[]) => ({
    id: row[0] as string,
    name: row[1] as string,
    html: row[2] as string,
    isDefault: row[3] as boolean,
    templateType: (row[4] as TemplateType) || "builtin",
    createdAt: new Date(row[5] as string),
  }));
};

export const getTemplateById = (id: string) => {
  const db = getDatabase();
  const rows = db.query(
    "SELECT id, name, html, is_default, template_type, created_at FROM templates WHERE id = ? LIMIT 1",
    [id],
  );
  if (rows.length === 0) {
    return undefined;
  }
  const row = rows[0] as unknown[];
  return {
    id: row[0] as string,
    name: row[1] as string,
    html: row[2] as string,
    isDefault: Boolean(row[3]),
    templateType: (row[4] as TemplateType) || "builtin",
    createdAt: new Date(row[5] as string),
  } as Template;
};

let builtInDefaultTemplate: Template | null | undefined;

function loadBuiltinTemplate(): Template | null {
  if (builtInDefaultTemplate !== undefined) {
    return builtInDefaultTemplate;
  }
  try {
    const url = new URL("../../static/templates/professional-modern.html", import.meta.url);
    const html = Deno.readTextFileSync(url);
    builtInDefaultTemplate = {
      id: "builtin-professional-modern",
      name: "Professional Modern",
      html,
      isDefault: true,
      templateType: "builtin",
      createdAt: new Date(0),
    };
  } catch (error) {
    console.error("Failed to load built-in template:", error);
    builtInDefaultTemplate = null;
  }
  return builtInDefaultTemplate ?? null;
}

export const getDefaultTemplate = (): Template | null => {
  const db = getDatabase();
  const defaultRows = db.query(
    "SELECT id, name, html, is_default, template_type, created_at FROM templates WHERE is_default = 1 ORDER BY created_at DESC LIMIT 1",
  );
  if (defaultRows.length > 0) {
    const row = defaultRows[0] as unknown[];
    return {
      id: row[0] as string,
      name: row[1] as string,
      html: row[2] as string,
      isDefault: Boolean(row[3]),
      templateType: (row[4] as TemplateType) || "builtin",
      createdAt: new Date(row[5] as string),
    };
  }

  const anyRows = db.query(
    "SELECT id, name, html, is_default, template_type, created_at FROM templates ORDER BY created_at DESC LIMIT 1",
  );
  if (anyRows.length > 0) {
    const row = anyRows[0] as unknown[];
    return {
      id: row[0] as string,
      name: row[1] as string,
      html: row[2] as string,
      isDefault: Boolean(row[3]),
      templateType: (row[4] as TemplateType) || "builtin",
      createdAt: new Date(row[5] as string),
    };
  }

  return loadBuiltinTemplate();
};

export const loadTemplateFromFile = async (
  filePath: string,
): Promise<string> => {
  try {
    return await Deno.readTextFile(filePath);
  } catch (error) {
    console.error(`Failed to load template from ${filePath}:`, error);
    throw new Error(`Template file not found: ${filePath}`);
  }
};

export const renderTemplate = (
  templateHtml: string,
  data: Record<string, unknown>,
): string => {
  const escapeHtml = (input: unknown): string => {
    const str = input === undefined || input === null ? "" : String(input);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // Lightweight Mustache-like renderer with block-first strategy
  const lookup = (obj: Record<string, unknown>, path: string): unknown => {
    const clean = path.trim().replace(/^['"]|['"]$/g, "");
    return clean.split(".").reduce<unknown>((acc, key) => {
      if (
        acc && typeof acc === "object" &&
        key in (acc as Record<string, unknown>)
      ) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  };

  const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => ({
    ...a,
    ...b,
  });

  const renderBlocks = (tpl: string, ctx: Record<string, unknown>): string => {
    const blockRe = /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
    let result = tpl;
    let match: RegExpExecArray | null;
    // Iterate until no blocks remain
    while ((match = blockRe.exec(result)) !== null) {
      const [full, rawKey, inner] = match;
      const key = rawKey.trim();
      const val = lookup(ctx, key);
      let replacement = "";
      if (Array.isArray(val)) {
        replacement = val.map((it) => {
          const scope = merge(ctx, (it as Record<string, unknown>) || {});
          return renderAll(inner, scope);
        }).join("");
      } else if (val) {
        replacement = renderAll(inner, ctx);
      } else {
        replacement = "";
      }
      result = result.slice(0, match.index) + replacement +
        result.slice(match.index + full.length);
      blockRe.lastIndex = 0; // reset after modifying string
    }
    return result;
  };

  const renderVars = (tpl: string, ctx: Record<string, unknown>): string => {
    return tpl.replace(/\{\{([^}]+)\}\}/g, (m, raw) => {
      const key = String(raw).trim();
      if (key.startsWith("#") || key.startsWith("/")) return m; // skip block tags
      // default value support: {{var || 'default'}}
      if (key.includes("||")) {
        const [lhs, rhs] = key.split("||").map((s: string) => s.trim());
        const val = lookup(ctx, lhs.replace(/['"]/g, ""));
        if (val === undefined || val === null || val === "") {
          return escapeHtml(rhs.replace(/^['"]|['"]$/g, ""));
        }
        return escapeHtml(val);
      }
      const v = lookup(ctx, key);
      return v !== undefined && v !== null ? escapeHtml(v) : "";
    });
  };

  const renderTriple = (tpl: string, ctx: Record<string, unknown>): string => {
    const tripleRe = /\{\{\{([^}]+)\}\}\}/g;
    return tpl.replace(tripleRe, (_m, raw) => {
      const key = String(raw).trim();
      const val = lookup(ctx, key);
      return val === undefined || val === null ? "" : String(val);
    });
  };

  const renderAll = (tpl: string, ctx: Record<string, unknown>): string => {
    const withBlocks = renderBlocks(tpl, ctx);
    const withTriple = renderTriple(withBlocks, ctx);
    return renderVars(withTriple, ctx);
  };

  return renderAll(templateHtml, data);
};

export const createTemplate = (data: Partial<Template>) => {
  const db = getDatabase();
  const templateId = generateUUID();

  const template: Template = {
    id: templateId,
    name: data.name!,
    html: data.html!,
    isDefault: data.isDefault || false,
    templateType: data.templateType || "local",
    createdAt: new Date(),
  };

  // If this new template is marked as default, unset default on all others first
  if (template.isDefault) {
    db.query("UPDATE templates SET is_default = 0");
  }

  db.query(
    "INSERT INTO templates (id, name, html, is_default, template_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      template.id,
      template.name,
      template.html,
      template.isDefault,
      template.templateType,
      template.createdAt,
    ],
  );

  return template;
};

// Insert or replace a template with a specific id (used by manifest installs)
export const upsertTemplateWithId = (
  id: string,
  data: Partial<Template>,
) => {
  const db = getDatabase();
  if (data.isDefault === true) {
    db.query("UPDATE templates SET is_default = 0 WHERE id != ?", [id]);
  }
  db.query(
    "INSERT OR REPLACE INTO templates (id, name, html, is_default, template_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      id,
      data.name || id,
      data.html || "",
      data.isDefault || false,
      data.templateType || "remote",
      new Date().toISOString(),
    ],
  );
  return getTemplateById(id);
};

export const updateTemplate = (id: string, data: Partial<Template>) => {
  const db = getDatabase();
  // Enforce a single default when toggling isDefault to true
  if (data.isDefault === true) {
    db.query("UPDATE templates SET is_default = 0 WHERE id != ?", [id]);
  }

  db.query(
    "UPDATE templates SET name = ?, html = ?, is_default = ? WHERE id = ?",
    [data.name, data.html, data.isDefault, id],
  );

  const result = db.query(
    "SELECT id, name, html, is_default, template_type, created_at FROM templates WHERE id = ?",
    [id],
  );
  if (result.length > 0) {
    const row = result[0] as unknown[];
    return {
      id: row[0] as string,
      name: row[1] as string,
      html: row[2] as string,
      isDefault: row[3] as boolean,
      templateType: (row[4] as TemplateType) || "builtin",
      createdAt: new Date(row[5] as string),
    };
  }
  return null;
};

export const deleteTemplate = (id: string) => {
  const db = getDatabase();
  db.query("DELETE FROM templates WHERE id = ?", [id]);
  // Best-effort cleanup of stored files for this template id (all versions)
  try {
    const dir = resolveInDataRoot("templates", id);
    // Remove recursively if exists
    Deno.removeSync(dir, { recursive: true });
  } catch (_e) {
    // ignore missing or permission errors
  }
  return true;
};

// Set the active default template by id, unsetting all others
export const setDefaultTemplate = (id: string) => {
  const db = getDatabase();
  // Reset all
  db.query("UPDATE templates SET is_default = 0");
  // Set requested id; ignore if not found (no rows updated)
  db.query("UPDATE templates SET is_default = 1 WHERE id = ?", [id]);
  return true;
};

// Local zip manifest schema (similar to remote manifests)
type LocalManifest = {
  id: string;
  name: string;
  version?: string;
  html: {
    path: string;
  };
};

function assertLocalManifestShape(m: unknown): asserts m is LocalManifest {
  if (!m || typeof m !== "object") {
    throw new Error("Manifest must be an object");
  }
  const r = m as Record<string, unknown>;
  for (const k of ["id", "name", "html"]) {
    if (!(k in r)) throw new Error(`Manifest missing ${k}`);
  }
  const html = r.html as Record<string, unknown>;
  if (!html || typeof html.path !== "string") {
    throw new Error("html.path is required");
  }
}

// Install a template from an uploaded .zip file (local template)
export async function installLocalTemplateFromZip(
  zipData: Uint8Array<ArrayBuffer>,
): Promise<Template> {
  // Create a blob from the zip data for the ZipReader
  const blob = new Blob([zipData]);
  const zipReader = new ZipReader(blob.stream());

  try {
    const entries = await zipReader.getEntries();

    // Detect if files are in a subfolder (Windows-style zip)
    // Look for manifest at root first, then check for single subfolder
    let rootPrefix = "";
    let manifestEntry = entries.find(
      (e: { filename: string }) =>
        e.filename === "manifest.yaml" ||
        e.filename === "manifest.yml" ||
        e.filename === "manifest.json",
    );

    if (!manifestEntry) {
      // Check if there's a single root folder containing the manifest
      const topLevelDirs = new Set<string>();
      for (const entry of entries) {
        const parts = entry.filename.split("/");
        if (parts.length > 1 && parts[0]) {
          topLevelDirs.add(parts[0]);
        }
      }

      // If there's exactly one top-level directory, look for manifest inside it
      if (topLevelDirs.size === 1) {
        const folderName = [...topLevelDirs][0];
        rootPrefix = `${folderName}/`;
        manifestEntry = entries.find(
          (e: { filename: string }) =>
            e.filename === `${rootPrefix}manifest.yaml` ||
            e.filename === `${rootPrefix}manifest.yml` ||
            e.filename === `${rootPrefix}manifest.json`,
        );
      }
    }

    if (!manifestEntry) {
      throw new Error(
        "No manifest.yaml or manifest.json found in zip root (or single subfolder)",
      );
    }

    // Read and parse manifest using a simpler approach
    const manifestChunks: Uint8Array[] = [];
    const manifestWriter = new WritableStream<Uint8Array>({
      write(chunk: Uint8Array) {
        manifestChunks.push(chunk);
      },
    });
    await manifestEntry.getData!(manifestWriter);
    const manifestBytes = new Uint8Array(
      manifestChunks.reduce((acc: number, c: Uint8Array) => acc + c.length, 0),
    );
    let offset = 0;
    for (const chunk of manifestChunks) {
      manifestBytes.set(chunk, offset);
      offset += chunk.length;
    }
    const manifestText = new TextDecoder().decode(manifestBytes);

    let manifest: LocalManifest;
    try {
      manifest = parseYaml(manifestText) as LocalManifest;
    } catch (_e) {
      try {
        manifest = JSON.parse(manifestText) as LocalManifest;
      } catch {
        throw new Error("Manifest parse failed");
      }
    }
    assertLocalManifestShape(manifest);

    const manifestId = enforceSafeIdentifier(manifest.id, "manifest.id");
    const manifestVersion = manifest.version
      ? enforceSafeIdentifier(manifest.version, "manifest.version")
      : "1.0.0";
    const htmlPath = sanitizeManifestPath(String(manifest.html.path));

    // Find and read the HTML file (check with rootPrefix for Windows-style zips)
    const htmlEntry = entries.find(
      (e: { filename: string }) =>
        e.filename === `${rootPrefix}${htmlPath}` ||
        e.filename === `${rootPrefix}./${htmlPath}` ||
        e.filename === htmlPath ||
        e.filename === `./${htmlPath}`,
    );
    if (!htmlEntry) {
      throw new Error(`HTML file not found in zip: ${htmlPath}`);
    }

    const htmlChunks: Uint8Array[] = [];
    const htmlWriter = new WritableStream<Uint8Array>({
      write(chunk: Uint8Array) {
        htmlChunks.push(chunk);
      },
    });
    await htmlEntry.getData!(htmlWriter);
    const htmlBytes = new Uint8Array(
      htmlChunks.reduce((acc: number, c: Uint8Array) => acc + c.length, 0),
    );
    let htmlOffset = 0;
    for (const chunk of htmlChunks) {
      htmlBytes.set(chunk, htmlOffset);
      htmlOffset += chunk.length;
    }

    if (htmlBytes.byteLength > 128 * 1024) {
      throw new Error("HTML too large (>128KB)");
    }

    const html = new TextDecoder().decode(htmlBytes);
    basicHtmlSanity(html);

    // Store template files on disk
    const baseDir = resolveInDataRoot("templates", manifestId, manifestVersion);
    const outPath = resolve(baseDir, htmlPath);
    const rel = relative(baseDir, outPath);
    if (!rel || rel.startsWith("..")) {
      throw new Error("html.path escapes template directory");
    }

    await Deno.mkdir(dirname(outPath), { recursive: true });
    await Deno.writeTextFile(outPath, html);

    // Save to database as local template (no source URL stored)
    const saved = upsertTemplateWithId(manifestId, {
      name: `${manifest.name} ${manifestVersion ? `v${manifestVersion}` : ""}`
        .trim(),
      html,
      isDefault: false,
      templateType: "local",
    });

    return saved!;
  } finally {
    await zipReader.close();
  }
}
