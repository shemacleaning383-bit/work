import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'bluepark-test-'));
process.env.DEMO_STAGE_DELAY_MS = '0';
process.env.REQUIRE_LAUNCH_REVIEW = 'false';
process.env.RATE_LIMIT_SCALE = '1000';

const { createApp } = await import('../server/app.ts');

export async function startTestApp(opts: Parameters<typeof createApp>[0] = {}) {
  const app = createApp({ mode: 'demo', dbFile: `t-${Math.random().toString(36).slice(2)}.sqlite`, stageDelayMs: 0, quiet: true, ...opts });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  app.ctx.baseUrl = base;
  return {
    ...app,
    base,
    client: () => new Client(base),
    drain: () => app.worker.drain(200),
    close: () => new Promise<void>((r) => { app.server.closeAllConnections(); app.server.close(() => r()); }),
  };
}

export class Client {
  cookie = '';
  base: string;
  constructor(base: string) {
    this.base = base;
  }
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const isRaw = body instanceof Uint8Array || typeof body === 'string';
    const res = await fetch(this.base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(method !== 'GET' ? { 'x-bp': '1' } : {}),
        ...(body !== undefined && !isRaw ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isRaw ? (body as any) : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* html */
    }
    return { status: res.status, data, headers: res.headers };
  }
  get(p: string) { return this.req('GET', p); }
  post(p: string, b: unknown = {}) { return this.req('POST', p, b); }
  put(p: string, b: unknown = {}) { return this.req('PUT', p, b); }
}
