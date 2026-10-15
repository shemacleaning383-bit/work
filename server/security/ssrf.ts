// Server-side fetching of user-supplied URLs. Guards against SSRF:
// - only http/https on default ports
// - every resolved address (including after redirects) must be public unicast;
//   the check happens inside the socket's DNS lookup so DNS rebinding can't swap it
// - redirects followed manually and re-validated, capped
// - response size and time capped; only text/html accepted unless overridden
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export class UnsafeUrlError extends Error {
  code = 'unsafe_url';
}

export function isPrivateAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) {
    const p = addr.split('.').map(Number);
    const [a, b] = p;
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||           // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && p[2] === 100) ||
      (a === 203 && b === 0 && p[2] === 113)
    );
  }
  if (v === 6) {
    const s = addr.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(s)) return true; // mapped, hex form — reject
    return /^(fc|fd|fe8|fe9|fea|feb|ff|2001:db8|64:ff9b)/.test(s);
  }
  return true;
}

export function validateUrlShape(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError('That doesn’t look like a web address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('Only web (http/https) links are supported.');
  if (u.username || u.password) throw new UnsafeUrlError('Links with embedded credentials are not supported.');
  if (u.port && !['80', '443'].includes(u.port)) throw new UnsafeUrlError('Links on non-standard ports are not supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError('Private network addresses are not allowed.');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new UnsafeUrlError('Private network addresses are not allowed.');
  if (!isIP(host) && !host.includes('.')) throw new UnsafeUrlError('Please use a full web address.');
  return u;
}

function safeLookup(hostname: string, options: any, cb: any) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: any) => {
    if (err) return cb(err);
    const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family }]) as { address: string; family: number }[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) return cb(new UnsafeUrlError('Destination resolves to a private network address.'));
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  redirects: string[];
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: RegExp;
  /** Only follow redirects; don't read the body. Used to expand short links. */
  resolveOnly?: boolean;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxRedirects = opts.maxRedirects ?? 4;
  const accept = opts.accept ?? /^(text\/html|application\/xhtml\+xml)/i;
  const redirects: string[] = [];
  let url = validateUrlShape(rawUrl);
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(url, Math.max(500, deadline - Date.now()), maxBytes, opts.resolveOnly ?? false);
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop === maxRedirects) throw new UnsafeUrlError('Too many redirects.');
      const next = new URL(res.location, url);
      // Never allow https -> http downgrade.
      if (url.protocol === 'https:' && next.protocol === 'http:') throw new UnsafeUrlError('Unsafe redirect (downgrade to http).');
      url = validateUrlShape(next.toString());
      redirects.push(url.toString());
      continue;
    }
    if (opts.resolveOnly) return { url: url.toString(), status: res.status, contentType: res.contentType, body: '', redirects };
    if (!accept.test(res.contentType)) throw new UnsafeUrlError(`Unsupported content type (${res.contentType || 'unknown'}).`);
    return { url: url.toString(), status: res.status, contentType: res.contentType, body: res.body, redirects };
  }
  throw new UnsafeUrlError('Too many redirects.');
}

function requestOnce(url: URL, timeoutMs: number, maxBytes: number, headOnly: boolean): Promise<{ status: number; location?: string; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      lookup: safeLookup as any,
      headers: {
        'user-agent': 'BlueParkBot/0.1 (+business preview research; contact via site)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'accept-language': 'en-CA,en;q=0.8',
      },
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers['content-type'] ?? '');
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, location: res.headers.location, contentType, body: '' });
      }
      if (headOnly) {
        res.destroy();
        return resolve({ status, contentType, body: '' });
      }
      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared > maxBytes) {
        res.destroy();
        return reject(new UnsafeUrlError('The page is too large to read.'));
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new UnsafeUrlError('The page is too large to read.'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });
}
