import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { OFFER, type OfferConfig } from '../shared/offer.ts';
import type { Mode } from '../shared/types.ts';

// Load .env (simple KEY=VALUE lines) without a dependency. Real env wins.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k: string, d = ''): string => process.env[k] ?? d;
const num = (k: string, d: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d;
};

const mode: Mode = env('BLUEPARK_MODE', 'demo') === 'live' ? 'live' : 'demo';

const offer: OfferConfig = {
  ...OFFER,
  previewTargetBusinessDays: num('PREVIEW_TARGET_BUSINESS_DAYS', OFFER.previewTargetBusinessDays),
  updateTurnaroundBusinessDays: num('UPDATE_TURNAROUND_BUSINESS_DAYS', OFFER.updateTurnaroundBusinessDays),
};

export const config = {
  mode,
  isDemo: mode === 'demo',
  port: num('PORT', 3000),
  host: env('HOST', '0.0.0.0'),
  publicBaseUrl: env('PUBLIC_BASE_URL', `http://localhost:${num('PORT', 3000)}`),
  dataDir: resolve(env('DATA_DIR', 'data')),
  sessionSecret: env('SESSION_SECRET', mode === 'demo' ? 'demo-only-not-secret-change-me' : ''),
  adminPassword: env('ADMIN_PASSWORD'),
  secureCookies: env('SECURE_COOKIES', mode === 'live' ? 'true' : 'false') === 'true',
  /** Demo stage pacing so progress is observable; 0 in tests. */
  demoStageDelayMs: num('DEMO_STAGE_DELAY_MS', 2200),
  workerPollMs: num('WORKER_POLL_MS', 400),
  runWorker: env('RUN_WORKER', 'true') !== 'false',
  review: {
    // Ops can require a human review before previews are delivered or sites launched.
    requirePreviewReview: env('REQUIRE_PREVIEW_REVIEW', 'false') === 'true',
    requireLaunchReview: env('REQUIRE_LAUNCH_REVIEW', 'true') === 'true',
  },
  hosting: {
    baseDomain: env('HOSTING_BASE_DOMAIN', 'sites.bluepark.example'),
    cnameTarget: env('HOSTING_CNAME_TARGET', 'cname.bluepark.example'),
    apexIp: env('HOSTING_APEX_IP', '192.0.2.10'),
  },
  providers: {
    googlePlacesKey: env('GOOGLE_PLACES_API_KEY'),
    stripeSecretKey: env('STRIPE_SECRET_KEY'),
    stripeWebhookSecret: env('STRIPE_WEBHOOK_SECRET'),
    stripePriceId: env('STRIPE_PRICE_ID'),
    stripeAutomaticTax: env('STRIPE_AUTOMATIC_TAX', 'true') === 'true',
    telnyxApiKey: env('TELNYX_API_KEY'),
    telnyxFrom: env('TELNYX_FROM_NUMBER'),
    resendApiKey: env('RESEND_API_KEY'),
    emailFrom: env('EMAIL_FROM'),
    screenshotsEnabled: env('SCREENSHOTS', 'auto'),
    chromiumPath: env('CHROMIUM_PATH'),
  },
  offer,
};

export function assertProductionSafe(): string[] {
  const problems: string[] = [];
  if (config.mode === 'live') {
    if (!config.sessionSecret || config.sessionSecret.length < 32) problems.push('SESSION_SECRET must be set (32+ chars) in live mode.');
    if (!config.adminPassword || config.adminPassword.length < 12) problems.push('ADMIN_PASSWORD must be set (12+ chars) in live mode.');
  }
  return problems;
}
