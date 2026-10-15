// Live adapters. Each one is only real when configured; otherwise it reports
// itself unavailable. Nothing here falls back to demo fixtures.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve4, resolveCname, resolveTxt } from 'node:dns/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.ts';
import { safeFetch, isPrivateAddress, validateUrlShape } from '../../security/ssrf.ts';
import { extractFacts, internalLinks } from './extract.ts';
import { slugify, normalizePhone } from '../../../shared/validate.ts';
import type {
  Adapters, LookupAdapter, ResearchAdapter, ScreenshotAdapter, NotifyAdapter, PaymentAdapter,
  PaymentEvent, DomainAdapter, PublishAdapter, CandidateInternal, SourceResult, Observations,
} from '../types.ts';
import type { ClassifiedIdentifier } from '../../../shared/validate.ts';
import { lookup as dnsLookup } from 'node:dns/promises';

const nowIso = () => new Date().toISOString();

// ---------- Screenshots (Playwright, if installed) ----------
let browserPromise: Promise<any> | null = null;
async function getBrowser(): Promise<any | null> {
  if (config.providers.screenshotsEnabled === 'off') return null;
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const pw: any = await import('playwright-core');
        const candidates = [config.providers.chromiumPath, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean) as string[];
        const executablePath = candidates.find((p) => existsSync(p));
        return await pw.chromium.launch({ executablePath, args: ['--no-sandbox'] });
      } catch {
        return null;
      }
    })();
  }
  return browserPromise;
}

export const liveScreenshots: ScreenshotAdapter = {
  name: 'playwright',
  available: () => config.providers.screenshotsEnabled !== 'off',
  async capture(url) {
    validateUrlShape(url);
    const browser = await getBrowser();
    if (!browser) return null;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, javaScriptEnabled: true });
    const page = await ctx.newPage();
    // Block any request that resolves to a private address (SSRF guard for the browser).
    await page.route('**/*', async (route: any) => {
      try {
        const u = new URL(route.request().url());
        if (!/^https?:$/.test(u.protocol)) return route.abort();
        const addrs = await dnsLookup(u.hostname, { all: true });
        if (addrs.some((a) => isPrivateAddress(a.address))) return route.abort();
        return route.continue();
      } catch {
        return route.abort();
      }
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      await page.waitForTimeout(800);
      const dir = join(config.dataDir, 'uploads', 'captures');
      mkdirSync(dir, { recursive: true });
      const name = `${slugify(new URL(url).hostname)}-${Date.now()}.jpg`;
      await page.screenshot({ path: join(dir, name), type: 'jpeg', quality: 70 });
      return `/files/captures/${name}`;
    } catch {
      return null;
    } finally {
      await ctx.close().catch(() => {});
    }
  },
};

// ---------- Website + Google Places lookup ----------
async function websiteSource(url: string): Promise<SourceResult> {
  try {
    const res = await safeFetch(url);
    if (res.status >= 400) return { kind: 'website', label: 'Website', url, status: 'failed', error: `Website returned HTTP ${res.status}.`, observations: {}, isSample: false };
    return { kind: 'website', label: 'Website', url: res.url, status: 'ok', observations: extractFacts(res.body, res.url), isSample: false };
  } catch (e: any) {
    return { kind: 'website', label: 'Website', url, status: 'failed', error: e?.code === 'unsafe_url' ? e.message : 'We couldn’t load this website.', observations: {}, isSample: false };
  }
}

interface Place {
  id: string; displayName?: { text: string }; formattedAddress?: string; nationalPhoneNumber?: string;
  internationalPhoneNumber?: string; websiteUri?: string; googleMapsUri?: string; rating?: number;
  userRatingCount?: number; primaryTypeDisplayName?: { text: string };
  addressComponents?: { longText: string; types: string[] }[];
}

async function placesSearch(query: string): Promise<Place[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': config.providers.googlePlacesKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.addressComponents',
    },
    body: JSON.stringify({ textQuery: query, regionCode: 'CA', languageCode: 'en', pageSize: 5 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}`);
  const data = (await res.json()) as { places?: Place[] };
  return data.places ?? [];
}

function placeToCandidate(p: Place, confidence: CandidateInternal['confidence']): CandidateInternal {
  const city = p.addressComponents?.find((c) => c.types.includes('locality'))?.longText ?? '';
  const phone = normalizePhone(p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? '') ?? undefined;
  const name = p.displayName?.text ?? 'Unnamed business';
  const obs: Observations = { displayName: name, city, ...(phone ? { publicPhone: phone } : {}), ...(p.websiteUri ? { website: p.websiteUri } : {}), ...(city ? { areas: [city] } : {}) };
  return {
    id: `gp_${p.id}`,
    businessKey: `google:${p.id}`,
    name,
    city,
    address: p.formattedAddress,
    phone,
    website: p.websiteUri,
    category: p.primaryTypeDisplayName?.text,
    sourceKind: 'google',
    sourceLabel: 'Google Business Profile',
    sourceUrl: p.googleMapsUri,
    screenshotUrl: null,
    screenshotNote: 'We don’t capture screenshots of Google pages. Use the source link to check the listing.',
    foundAt: nowIso(),
    rating: p.rating ? { value: p.rating, count: p.userRatingCount ?? 0, label: 'Google rating' } : null,
    isSample: false,
    confidence,
    distinguishing: p.formattedAddress,
    initialSource: { kind: 'google', label: 'Google Business Profile', url: p.googleMapsUri, status: 'ok', observations: obs, isSample: false },
  };
}

export const liveLookup: LookupAdapter = {
  name: 'live',
  simulated: false,
  async lookup(id: ClassifiedIdentifier) {
    if (id.kind === 'website' && id.url) {
      const src = await websiteSource(id.url);
      if (src.status !== 'ok') return { status: 'error', candidates: [], message: src.error ?? 'We couldn’t load that website.' };
      const host = new URL(src.url!).hostname.replace(/^www\./, '');
      const shot = await liveScreenshots.capture(src.url!).catch(() => null);
      const o = src.observations;
      return {
        status: 'matches',
        candidates: [{
          id: `web_${slugify(host)}`,
          businessKey: `domain:${host}`,
          name: String(o.displayName ?? host),
          city: String(o.city ?? ''),
          phone: o.publicPhone as string | undefined,
          website: src.url,
          sourceKind: 'website',
          sourceLabel: 'Your website',
          sourceUrl: src.url,
          screenshotUrl: shot,
          screenshotNote: shot ? `Screenshot captured from ${host}.` : 'Screenshot unavailable for this website. Showing the details we could read instead.',
          foundAt: nowIso(),
          rating: null,
          isSample: false,
          confidence: 'exact',
          initialSource: { ...src, screenshotPath: shot },
        }],
      };
    }
    if (id.kind === 'google_maps' && id.url) {
      if (!config.providers.googlePlacesKey) return { status: 'unavailable', candidates: [], message: 'Google links can’t be read in this setup yet. Paste your website or type your business name and city instead.' };
      let full = id.url;
      try {
        full = (await safeFetch(id.url, { resolveOnly: true })).url;
      } catch {
        /* use original */
      }
      const nameFromPath = decodeURIComponent(full.match(/\/maps\/place\/([^/@]+)/)?.[1] ?? '').replace(/\+/g, ' ');
      const q = nameFromPath || new URL(full).searchParams.get('q') || '';
      if (!q) return { status: 'none', candidates: [], message: 'We couldn’t read a business from that link. Try your business name and city.' };
      const places = await placesSearch(q);
      return places.length ? { status: 'matches', candidates: places.slice(0, 3).map((p, i) => placeToCandidate(p, i === 0 && places.length === 1 ? 'exact' : 'likely')) } : { status: 'none', candidates: [] };
    }
    if (!config.providers.googlePlacesKey) return { status: 'unavailable', candidates: [], message: 'Name search isn’t connected in this setup yet. Paste your website link instead, or start without one.' };
    if (!id.location) return { status: 'needs_location', candidates: [], message: 'Which city or area is your business in?' };
    const places = await placesSearch(`${id.name} ${id.location}`);
    if (!places.length) return { status: 'none', candidates: [] };
    return { status: 'matches', candidates: places.slice(0, 4).map((p) => placeToCandidate(p, places.length === 1 ? 'exact' : 'possible')) };
  },
};

export const liveResearch: ResearchAdapter = {
  name: 'live-website-crawl',
  simulated: false,
  async research(c) {
    const sources: SourceResult[] = [c.initialSource];
    const site = c.website;
    if (site && c.initialSource.kind !== 'website') sources.push(await websiteSource(site));
    const home = sources.find((s) => s.kind === 'website' && s.status === 'ok');
    if (home?.url) {
      // Bounded crawl: up to 4 same-site pages that look like services/about/areas/contact.
      try {
        const res = await safeFetch(home.url);
        for (const link of internalLinks(res.body, res.url, 4)) {
          const sub = await websiteSource(link);
          sub.label = `Website page (${new URL(link).pathname})`;
          sources.push(sub);
        }
      } catch {
        /* homepage already recorded */
      }
    }
    return { sources, costCents: 0 };
  },
};

// ---------- Notifications ----------
export const liveNotify: NotifyAdapter = {
  name: 'live',
  simulated: false,
  supports(channel) {
    return channel === 'sms' ? !!(config.providers.telnyxApiKey && config.providers.telnyxFrom) : !!(config.providers.resendApiKey && config.providers.emailFrom);
  },
  async send(m) {
    if (!this.supports(m.channel)) return { status: 'failed', provider: 'none', error: `${m.channel === 'sms' ? 'Text messages' : 'Email'} are not configured.` };
    try {
      if (m.channel === 'sms') {
        const res = await fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: { authorization: `Bearer ${config.providers.telnyxApiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: config.providers.telnyxFrom, to: m.to, text: m.text }),
          signal: AbortSignal.timeout(10_000),
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) return { status: 'failed', provider: 'telnyx', error: `Provider rejected the message (HTTP ${res.status}).` };
        return { status: 'queued', provider: 'telnyx', providerId: data?.data?.id };
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${config.providers.resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: config.providers.emailFrom, to: [m.to], subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(10_000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { status: 'failed', provider: 'resend', error: `Provider rejected the message (HTTP ${res.status}).` };
      return { status: 'sent', provider: 'resend', providerId: data?.id };
    } catch {
      return { status: 'failed', provider: m.channel === 'sms' ? 'telnyx' : 'resend', error: 'Could not reach the messaging provider.' };
    }
  },
};

// ---------- Stripe (hosted Checkout + signed webhooks, via REST) ----------
async function stripe(path: string, params: Record<string, string>, idempotencyKey?: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.providers.stripeSecretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe HTTP ${res.status}`);
  return data;
}

export function verifyStripeSignature(rawBody: string, header: string, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export const stripePayments: PaymentAdapter = {
  name: 'stripe',
  simulated: false,
  async createCheckout({ projectId, successUrl, cancelUrl, email, idempotencyKey }) {
    const params: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': config.providers.stripePriceId,
      'line_items[0][quantity]': '1',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: projectId,
      'metadata[project_id]': projectId,
      'subscription_data[metadata][project_id]': projectId,
      billing_address_collection: 'required',
    };
    if (config.providers.stripeAutomaticTax) params['automatic_tax[enabled]'] = 'true';
    if (email) params.customer_email = email;
    const s = await stripe('checkout/sessions', params, idempotencyKey);
    return { sessionId: s.id, url: s.url };
  },
  parseWebhook(rawBody, headers) {
    const sig = String(headers['stripe-signature'] ?? '');
    if (!verifyStripeSignature(rawBody, sig, config.providers.stripeWebhookSecret)) throw new Error('Bad Stripe signature');
    const e = JSON.parse(rawBody);
    const o = e.data?.object ?? {};
    const projectId = o.metadata?.project_id ?? o.client_reference_id ?? o.subscription_details?.metadata?.project_id ?? null;
    const periodEnd = o.current_period_end ? new Date(o.current_period_end * 1000).toISOString() : null;
    const map: Record<string, PaymentEvent['type']> = {
      'checkout.session.completed': 'checkout.completed',
      'checkout.session.expired': 'checkout.expired',
      'invoice.payment_failed': 'payment.failed',
      'invoice.paid': 'invoice.paid',
      'customer.subscription.updated': 'subscription.updated',
      'customer.subscription.deleted': 'subscription.deleted',
    };
    return {
      id: e.id, type: map[e.type] ?? 'ignored', projectId,
      customerId: o.customer, subscriptionId: o.subscription ?? (o.object === 'subscription' ? o.id : undefined),
      periodEnd, cancelAtPeriodEnd: o.cancel_at_period_end, status: o.status, raw: { id: e.id, type: e.type },
    };
  },
  async cancelAtPeriodEnd(subscriptionId) {
    await stripe(`subscriptions/${subscriptionId}`, { cancel_at_period_end: 'true' });
  },
  async resume(subscriptionId) {
    await stripe(`subscriptions/${subscriptionId}`, { cancel_at_period_end: 'false' });
  },
};

// ---------- DNS verification (real lookups) ----------
export const liveDomains: DomainAdapter = {
  name: 'dns',
  simulated: false,
  async check(records) {
    const out = [];
    for (const r of records) {
      let observed: string[] = [];
      try {
        if (r.type === 'CNAME') observed = await resolveCname(r.host);
        else if (r.type === 'A') observed = await resolve4(r.host);
        else if (r.type === 'TXT') observed = (await resolveTxt(r.host)).map((x) => x.join(''));
      } catch {
        observed = [];
      }
      const want = r.value.replace(/\.$/, '').toLowerCase();
      out.push({ type: r.type, host: r.host, expected: r.value, observed, found: observed.some((o) => o.replace(/\.$/, '').toLowerCase() === want) });
    }
    return out;
  },
};

// ---------- Publishing: this server hosts sites; "live" requires a public URL check ----------
export const selfHostPublish: PublishAdapter = {
  name: 'self-hosted',
  simulated: false,
  async publish({ slug, domain }) {
    return { url: domain ? `https://${domain}/` : `${config.publicBaseUrl.replace(/\/$/, '')}/sites/${slug}/` };
  },
  async verify(url) {
    try {
      const res = await safeFetch(url, { timeoutMs: 8000 });
      return res.status === 200 && res.body.includes('data-bluepark-site');
    } catch {
      return false;
    }
  },
  async unpublish() {},
};

export function liveAdapters(): Adapters {
  const paymentsReady = !!(config.providers.stripeSecretKey && config.providers.stripeWebhookSecret && config.providers.stripePriceId);
  return {
    lookup: liveLookup,
    research: liveResearch,
    screenshots: liveScreenshots,
    notify: liveNotify,
    payments: paymentsReady ? stripePayments : unavailablePayments,
    domains: liveDomains,
    publish: selfHostPublish,
  };
}

const unavailablePayments: PaymentAdapter = {
  name: 'stripe',
  simulated: false,
  async createCheckout() {
    throw Object.assign(new Error('Payments are not configured yet. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID.'), { code: 'payments_unconfigured' });
  },
  parseWebhook() {
    throw new Error('Payments not configured');
  },
  async cancelAtPeriodEnd() {
    throw new Error('Payments not configured');
  },
  async resume() {
    throw new Error('Payments not configured');
  },
};
