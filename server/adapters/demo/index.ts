// Demo adapters: deterministic fixtures, no network, no messages, no charges.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  Adapters, LookupAdapter, ResearchAdapter, ScreenshotAdapter, NotifyAdapter,
  PaymentAdapter, PaymentEvent, DomainAdapter, PublishAdapter, CandidateInternal, LookupResult,
} from '../types.ts';
import { SUNDAY, SUNDAY_RESEARCH, SPARKLE, BRIGHTNEST, BRIGHTNEST_RESEARCH, MAPLE, demoShouldFail } from '../../../fixtures/demo.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const DEMO_WEBHOOK_SECRET = 'demo-webhook-secret';

function match(text: string): LookupResult {
  const t = text.toLowerCase();
  if (t.includes('sunday')) return { status: 'matches', candidates: [SUNDAY] };
  if (t.includes('brightnest') || t.includes('bright nest')) return { status: 'matches', candidates: [BRIGHTNEST] };
  if (t.includes('maple')) return { status: 'matches', candidates: [MAPLE] };
  if (t.includes('sparkle')) return { status: 'matches', candidates: SPARKLE };
  return {
    status: 'none',
    candidates: [],
    message: 'No match in the demo data. Try “Sunday Cleaning”, “Sparkle Clean, Toronto”, “brightnest.example” or “Maple Fresh”.',
  };
}

export const demoLookup: LookupAdapter = {
  name: 'demo-fixtures',
  simulated: true,
  async lookup(id) {
    await sleep(350);
    if (id.kind === 'name') {
      const t = (id.name ?? '').toLowerCase();
      if (t.includes('sparkle')) {
        if (!id.location) return { status: 'needs_location', candidates: [], message: 'A few businesses share that name. Which city or area are you in?' };
        const loc = id.location.toLowerCase();
        const local = SPARKLE.filter((c) => c.city.toLowerCase().includes(loc));
        return { status: 'matches', candidates: local.length ? local : SPARKLE };
      }
      return match(`${id.name} ${id.location ?? ''}`);
    }
    return match(id.url ?? '');
  },
};

export const demoResearch: ResearchAdapter = {
  name: 'demo-fixtures',
  simulated: true,
  async research(c: CandidateInternal) {
    if (c.id === SUNDAY.id) return { sources: SUNDAY_RESEARCH, costCents: 0 };
    if (c.id === BRIGHTNEST.id) return { sources: BRIGHTNEST_RESEARCH, costCents: 0 };
    return { sources: [c.initialSource], costCents: 0 };
  },
};

export const demoScreenshots: ScreenshotAdapter = {
  name: 'demo-none',
  available: () => false,
  async capture() {
    return null;
  },
};

export const demoNotify: NotifyAdapter = {
  name: 'demo-simulated',
  simulated: true,
  supports: () => true,
  async send(m) {
    if (demoShouldFail(m.to)) return { status: 'failed', provider: 'demo', error: 'Simulated delivery failure (demo rule: destination contains “fail” or ends in 0199).' };
    return { status: 'simulated', provider: 'demo' };
  },
};

/** Demo checkout posts events through the same webhook path, signed with a demo secret. */
export function signDemoEvent(body: string): string {
  return createHmac('sha256', DEMO_WEBHOOK_SECRET).update(body).digest('hex');
}

export const demoPayments: PaymentAdapter = {
  name: 'demo',
  simulated: true,
  async createCheckout({ projectId }) {
    const sessionId = `demo_cs_${randomBytes(8).toString('hex')}`;
    return { sessionId, url: `/demo/checkout/${sessionId}?project=${encodeURIComponent(projectId)}` };
  },
  parseWebhook(rawBody, headers) {
    const sig = String(headers['x-demo-signature'] ?? '');
    const expected = signDemoEvent(rawBody);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Bad demo signature');
    const e = JSON.parse(rawBody);
    return {
      id: String(e.id), type: e.type, projectId: e.projectId ?? null, subscriptionId: e.subscriptionId,
      customerId: e.customerId, periodEnd: e.periodEnd ?? null, cancelAtPeriodEnd: e.cancelAtPeriodEnd, message: e.message, raw: e,
    } satisfies PaymentEvent;
  },
  async cancelAtPeriodEnd() {},
  async resume() {},
};

export const demoDomains: DomainAdapter = {
  name: 'demo-dns',
  simulated: true,
  async check(records) {
    // Demo never pretends DNS is configured; real verification needs live DNS.
    return records.map((r) => ({ type: r.type, host: r.host, expected: r.value, found: false, observed: [] }));
  },
};

export const demoPublish: PublishAdapter = {
  name: 'demo-local-hosting',
  simulated: true,
  async publish({ slug }) {
    return { url: `/sites/${slug}/` };
  },
  async verify() {
    return true; // served by this same server from the database
  },
  async unpublish() {},
};

export function demoAdapters(): Adapters {
  return {
    lookup: demoLookup,
    research: demoResearch,
    screenshots: demoScreenshots,
    notify: demoNotify,
    payments: demoPayments,
    domains: demoDomains,
    publish: demoPublish,
  };
}
