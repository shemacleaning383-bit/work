import http from 'node:http';
import { join } from 'node:path';
import { config } from './config.ts';
import { openDb } from './db.ts';
import type { Ctx } from './ctx.ts';
import { selectAdapters } from './adapters/index.ts';
import type { Adapters } from './adapters/types.ts';
import { buildRouter, hostSiteFor, serveSite, simplePage } from './routes.ts';
import { json, html, serveStatic, securityHeaders, redact, APP_CSP, type Req } from './http.ts';
import { UserError } from './services/projects.ts';
import { Worker } from './services/jobs.ts';
import { HANDLERS, onJobFailure } from './services/pipeline.ts';
import type { Mode } from '../shared/types.ts';

export interface AppOptions {
  mode?: Mode;
  dbFile?: string;
  stageDelayMs?: number;
  runWorker?: boolean;
  adapters?: Adapters;
  baseUrl?: string;
  quiet?: boolean;
}

export function createApp(opts: AppOptions = {}) {
  const mode = opts.mode ?? config.mode;
  const db = openDb(config.dataDir, opts.dbFile ?? 'bluepark.sqlite');
  const ctx: Ctx = {
    db,
    adapters: opts.adapters ?? selectAdapters(mode),
    mode,
    demo: mode === 'demo',
    stageDelayMs: opts.stageDelayMs ?? config.demoStageDelayMs,
    baseUrl: opts.baseUrl ?? config.publicBaseUrl,
  };
  const router = buildRouter(ctx);
  const worker = new Worker(ctx, HANDLERS, onJobFailure, config.workerPollMs);
  const WEB = join(process.cwd(), 'web');
  const ROOT = process.cwd();

  const server = http.createServer(async (rawReq, res) => {
    const started = Date.now();
    const req = rawReq as Req;
    const url = new URL(req.url ?? '/', 'http://local');
    req.path = url.pathname;
    req.query = url.searchParams;
    req.params = {};
    req.ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    securityHeaders(res);
    try {
      // Custom domains: serve the customer's live site at the root of their domain.
      const host = String(req.headers.host ?? '');
      const slug = host && !host.startsWith('localhost') ? hostSiteFor(ctx, host) : null;
      if (slug && req.method === 'GET' && !req.path.startsWith('/files/')) {
        return serveSite(ctx, req, res, slug, req.path.replace(/^\/|\/$/g, ''));
      }
      if (req.method === 'GET') {
        if (req.path.startsWith('/assets/') && serveStatic(res, join(WEB, 'assets'), req.path.slice(8), { immutable: false })) return;
        if (req.path.startsWith('/app/') && /\.(ts|css)$/.test(req.path) && serveStatic(res, join(WEB, 'app'), req.path.slice(5))) return;
        if (req.path.startsWith('/shared/') && req.path.endsWith('.ts') && serveStatic(res, join(ROOT, 'shared'), req.path.slice(8))) return;
        if (req.path === '/favicon.ico') return serveStatic(res, join(WEB, 'assets'), 'favicon.svg') || void html(res, 404, '');
      }
      const m = router.match(req.method ?? 'GET', req.path);
      if (!m) {
        if (req.path.startsWith('/api/')) return json(res, 404, { error: 'Not found.', code: 'not_found' });
        return html(res, 404, simplePage('Page not found', '<p>That page doesn’t exist. <a href="/">Go home</a>.</p>'));
      }
      req.params = m.params;
      if (!res.hasHeader('content-security-policy') && !req.path.startsWith('/preview/') && !req.path.startsWith('/sites/')) res.setHeader('content-security-policy', APP_CSP);
      const out = await m.handler(req, res);
      if (!res.headersSent && out !== undefined) json(res, 200, out);
    } catch (err) {
      if (err instanceof UserError) {
        if (req.path.startsWith('/api/')) json(res, err.status, { error: err.message, code: err.code, field: err.field });
        else html(res, err.status, simplePage('Something needs attention', `<p>${err.message}</p>`));
      } else {
        console.error('[error]', req.method, req.path, err instanceof Error ? redact(err.stack ?? err.message) : err);
        if (req.path.startsWith('/api/')) json(res, 500, { error: 'Something went wrong on our side. Please try again.', code: 'server_error' });
        else if (!res.headersSent) html(res, 500, simplePage('Something went wrong', '<p>Please try again in a moment.</p>'));
      }
    } finally {
      if (!opts.quiet && !req.path.startsWith('/assets/') && !req.path.startsWith('/app/') && !req.path.startsWith('/shared/')) {
        const q = req.path.startsWith('/r/') ? '/r/[token]' : req.path;
        console.log(`${req.method} ${redact(q)} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  });

  return { server, ctx, worker, db };
}
