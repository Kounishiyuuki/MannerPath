// Fetch-shaped HTTPS transport with a *narrower* TLS policy than Node's default, for publishers whose
// servers prefer weak finite-field DHE (1024-bit) and therefore fail OpenSSL's default security level.
// Offering only ECDHE key exchange with AEAD ciphers never selects DHE; certificate and hostname
// verification, the security level and TLS minimums are unchanged or stricter. Redirects are never
// followed here: checkSourceHealth handles them with its same-origin policy.
import { request } from "node:https";
import { Readable } from "node:stream";
import { URL } from "node:url";

export const ECDHE_AEAD_CIPHERS = [
  "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-RSA-AES128-GCM-SHA256", "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384", "ECDHE-ECDSA-CHACHA20-POLY1305", "ECDHE-RSA-CHACHA20-POLY1305",
].join(":");

export function ecdheAeadFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:") return Promise.reject(new Error("HTTPS resource required"));
  if (init.body !== undefined && init.body !== null && typeof init.body !== "string") return Promise.reject(new Error("only string request bodies are supported"));
  const body = init.body ?? undefined;
  return new Promise((resolve, reject) => {
    const req = request(target, {
      method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal ?? undefined,
      agent: false, minVersion: "TLSv1.2", ciphers: ECDHE_AEAD_CIPHERS, rejectUnauthorized: true,
    }, res => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) for (const item of [value].flat()) headers.append(name, item);
      const status = res.statusCode ?? 0;
      const empty = [204, 205, 304].includes(status);
      if (empty) res.resume();
      try {
        resolve(new Response(empty ? null : Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>, { status, headers }));
      } catch (error) { res.destroy(); reject(new Error("invalid HTTP response", { cause: error })); }
    });
    // Mirror fetch: the TLS/socket error (with its symbolic code) is the cause.
    req.on("error", error => reject(new Error("fetch failed", { cause: error })));
    req.end(body);
  });
}
