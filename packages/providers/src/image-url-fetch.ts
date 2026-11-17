import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

/**
 * SSRF-safe image URL ingestion ("Add Multiple Products" spec: "Paste
 * image URL" — Main/Additional Images/Meta Image). The whole point of
 * this file is that the actual TCP connection can never land anywhere
 * other than an address this code itself already validated:
 *
 * 1. Resolve the hostname via DNS once, reject any private/loopback/
 *    link-local/reserved address among the results.
 * 2. Connect using a custom `lookup` that ALWAYS returns that one
 *    validated address, regardless of what DNS answers on any later
 *    query — this is what actually closes the DNS-rebinding gap (a
 *    naive "resolve, check, then let fetch() resolve again itself"
 *    approach doesn't; the second resolution could return something
 *    different).
 * 3. Every redirect hop is followed MANUALLY, re-running steps 1-2 on the
 *    new target from scratch — never delegated to fetch's own redirect
 *    following, which would bypass this validation entirely on hop 2+.
 * 4. Content-Length (when present) and a running byte counter both cap
 *    the response size; a timeout bounds the whole request; only an
 *    `image/*` Content-Type is accepted.
 */

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a >= 224) return true; // multicast/reserved (224.0.0.0/4 and above)
  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb"))
    return true; // fe80::/10 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIpv4(mapped[1]!);
  return false;
}

/** Exported for direct unit testing (packages/providers/src/image-url-fetch.test.ts) — the real network path (fetchImageFromUrl) isn't something a unit test should exercise against live hosts. */
export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateOrReservedIpv4(ip);
  if (version === 6) return isPrivateOrReservedIpv6(ip);
  return true; // not a recognizable IP at all — fail closed
}

async function resolveAndPin(hostname: string): Promise<string> {
  if (hostname.toLowerCase() === "localhost") throw new Error("That address isn't allowed.");
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error("That address isn't allowed.");
    return hostname;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("Could not resolve that host.");
  for (const record of records) {
    if (isBlockedAddress(record.address)) throw new Error("That address isn't allowed.");
  }
  return records[0]!.address;
}

type FetchOnceResult =
  | { kind: "ok"; buffer: Buffer; contentType: string }
  | { kind: "redirect"; location: string }
  | { kind: "error"; error: string };

function fetchOnce(url: URL, pinnedIp: string): Promise<FetchOnceResult> {
  return new Promise((resolve) => {
    const lib = url.protocol === "https:" ? https : http;
    const ipVersion = net.isIP(pinnedIp) as 4 | 6;
    const req = lib.request(
      {
        hostname: url.hostname, // kept for correct Host header / TLS SNI
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        timeout: FETCH_TIMEOUT_MS,
        headers: { "User-Agent": "Kisan4U-ImageFetcher/1.0", Accept: "image/*" },
        // The one line that actually pins the connection — whatever `lookup`
        // returns is where the socket connects, full stop, regardless of
        // what any DNS server (including a rebinding attacker) says next.
        //
        // Must use the multi-address ("all") callback form — Node's newer
        // Happy-Eyeballs connection path (lookupAndConnectMultiple, the
        // default since it started being used internally regardless of the
        // `all` option) always calls a custom `lookup` expecting an array
        // of {address, family} results now, not the legacy single
        // (err, address, family) form. The legacy form throws
        // ERR_INVALID_IP_ADDRESS at connect time on Node 24 — confirmed by
        // reproducing it directly against this exact host/port before
        // applying this fix, not assumed from changelog reading alone.
        lookup: (_hostname, _options, callback) =>
          (callback as (err: null, addresses: { address: string; family: number }[]) => void)(null, [
            { address: pinnedIp, family: ipVersion },
          ]),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ kind: "redirect", location: res.headers.location });
          return;
        }
        if (status !== 200) {
          res.resume();
          resolve({ kind: "error", error: `The image URL returned HTTP ${status}.` });
          return;
        }
        const contentType = res.headers["content-type"] ?? "";
        if (!contentType.toLowerCase().startsWith("image/")) {
          res.resume();
          resolve({ kind: "error", error: "That URL did not return an image." });
          return;
        }
        const declaredLength = Number(res.headers["content-length"] ?? "0");
        if (declaredLength > MAX_SOURCE_BYTES) {
          res.resume();
          resolve({ kind: "error", error: "Image is too large." });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_SOURCE_BYTES) {
            req.destroy();
            resolve({ kind: "error", error: "Image is too large." });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (total <= MAX_SOURCE_BYTES) {
            resolve({ kind: "ok", buffer: Buffer.concat(chunks), contentType });
          }
        });
        res.on("error", () => resolve({ kind: "error", error: "Failed to read the image." }));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ kind: "error", error: "The image URL took too long to respond." });
    });
    req.on("error", () => resolve({ kind: "error", error: "Failed to fetch the image URL." }));
    req.end();
  });
}

export type FetchImageUrlResult =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; error: string };

export async function fetchImageFromUrl(rawUrl: string): Promise<FetchImageUrlResult> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
      return { ok: false, error: "Only http:// and https:// image URLs are allowed." };
    }
    let pinnedIp: string;
    try {
      pinnedIp = await resolveAndPin(currentUrl.hostname);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "That address isn't allowed." };
    }

    const result = await fetchOnce(currentUrl, pinnedIp);
    if (result.kind === "redirect") {
      try {
        currentUrl = new URL(result.location, currentUrl);
      } catch {
        return { ok: false, error: "The image URL redirected somewhere invalid." };
      }
      continue;
    }
    if (result.kind === "error") return { ok: false, error: result.error };
    return { ok: true, buffer: result.buffer, contentType: result.contentType };
  }
  return { ok: false, error: "Too many redirects." };
}
