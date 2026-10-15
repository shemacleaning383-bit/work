// Minimal HTTP toolkit: routing, JSON bodies, static files (with on-the-fly
// TypeScript type stripping for browser modules), security headers, rate limits.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { UserError } from './services/projects.ts';

export type Req = IncomingMessage & { params: Record<string, string>; query: URLSearchParams; path: string; ip: string };
export type Res = ServerResponse;
export type RouteHandler = (req: Req, res: Res) => Promise<unknown> | unknown;

interface Route { method: string; parts: string[]; handler: RouteHandler }

export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, handler: RouteHandler) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }
  get(p: string, h: RouteHandler) { this.add('GET', p, h); }
  post(p: string, h: RouteHandler) { this.add('POST', p, h); }
  put(p: string, h: RouteHandler) { this.add('PUT', p, h); }
  patch(p: string, h: RouteHandler) { this.add('PATCH', p, h); }
  delete(p: string, h: RouteHandler) { this.add('DELETE', p, h); }

  match(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | null {
    const segs = path.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      let ok = true;
      const rest = r.parts[r.parts.length - 1] === '*';
      if (!rest && r.parts.length !== segs.length) continue;
      if (rest && segs.length < r.parts.length - 1) continue;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i];
        if (p === '*') {
          params['*'] = segs.slice(i).map(decodeURIComponent).join('/');
          break;
        }
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i] ?? '');
        else if (p !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new UserError('That upload is too large.', 'too_large', 413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new UserError('That upload is too large.', 'too_large', 413);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = any>(req: IncomingMessage, limit = 64 * 1024): Promise<T> {
  const ct = String(req.headers['content-type'] ?? '');
  if (!ct.includes('application/json')) throw new UserError('Expected JSON.', 'bad_content_type', 415);
  const buf = await readBody(req, limit);
  try {
    return (buf.length ? JSON.parse(buf.toString('utf8')) : {}) as T;
  } catch {
    throw new UserError('Malformed request.', 'bad_json', 400);
  }
}

export async function readForm(req: IncomingMessage, limit = 32 * 1024): Promise<URLSearchParams> {
  const buf = await readBody(req, limit);
  return new URLSearchParams(buf.toString('utf8'));
}

export function json(res: Res, status: number, body: unknown) {
  if (res.headersSent) return;
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
}

export function html(res: Res, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

export function redirect(res: Res, to: string, status = 303) {
  res.writeHead(status, { location: to, 'cache-control': 'no-store' });
  res.end();
}

export const APP_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
export const PREVIEW_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'; sandbox allow-scripts allow-forms allow-popups";
export const LIVE_SITE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function securityHeaders(res: Res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'geolocation=(), microphone=(), payment=()');
}

// ---------- static ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const tsCache = new Map<string, { mtime: number; code: string }>();

export function serveStatic(res: Res, root: string, rel: string, opts: { immutable?: boolean } = {}): boolean {
  const base = resolve(root);
  const full = normalize(join(base, rel));
  if (!full.startsWith(base) || !existsSync(full)) return false;
  const st = statSync(full);
  if (!st.isFile()) return false;
  const ext = extname(full);
  let body: Buffer | string;
  if (ext === '.ts') {
    const c = tsCache.get(full);
    if (c && c.mtime === st.mtimeMs) body = c.code;
    else {
      body = stripTypeScriptTypes(readFileSync(full, 'utf8'), { mode: 'strip' });
      tsCache.set(full, { mtime: st.mtimeMs, code: body });
    }
  } else body = readFileSync(full);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': opts.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    etag: `"${st.size}-${Math.floor(st.mtimeMs)}"`,
  });
  res.end(body);
  return true;
}

// ---------- rate limiting (in-memory token buckets) ----------
const buckets = new Map<string, { tokens: number; at: number }>();
export function rateLimit(key: string, perMinute: number, burst = perMinute): boolean {
  const nowMs = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, at: nowMs };
  b.tokens = Math.min(burst, b.tokens + ((nowMs - b.at) / 60_000) * perMinute);
  b.at = nowMs;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) buckets.clear();
  return true;
}

export function redact(s: string): string {
  return s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\+?\d[\d\s().-]{8,}\d/g, '[phone]');
}
