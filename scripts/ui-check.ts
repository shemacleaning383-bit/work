// Drives the full customer journey in Chromium at phone width against an
// in-process demo server, checking for console errors, failed requests and
// horizontal overflow, and saving screenshots. Also takes lab perf readings.
// Usage: npm run ui:check  (OUT_DIR=… to change the screenshot folder)
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'bluepark-ui-'));
process.env.REQUIRE_LAUNCH_REVIEW = 'false';
const { createApp } = await import('../server/app.ts');
const { launchChromium } = await import('./browser.ts');

const OUT = process.env.OUT_DIR ?? join(process.cwd(), 'docs', 'screens');
mkdirSync(OUT, { recursive: true });
const app = createApp({ mode: 'demo', stageDelayMs: Number(process.env.DEMO_STAGE_DELAY_MS ?? 250), quiet: true });
await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
app.ctx.baseUrl = base;
app.worker.start();

const problems: string[] = [];
const browser = await launchChromium();

async function newPage(width: number, height = 844) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700 });
  const page = await ctx.newPage();
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console error @${page.url()}: ${m.text()}`); });
  page.on('pageerror', (e: any) => problems.push(`page error @${page.url()}: ${e.message}`));
  page.on('response', (r: any) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  return { ctx, page };
}

async function overflow(page: any, label: string) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (o.sw > o.cw + 1) problems.push(`horizontal overflow on ${label}: ${o.sw} > ${o.cw}`);
}

async function smallTargets(page: any, label: string) {
  const bad = await page.evaluate(() => [...document.querySelectorAll('main button, main a.btn, main .chip, .actionbar button, .actionbar a')]
    .filter((el) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40; })
    .map((el) => (el as HTMLElement).innerText.trim().slice(0, 30)));
  if (bad.length) problems.push(`small touch targets on ${label}: ${bad.slice(0, 5).join(' | ')}`);
}

let n = 0;
async function shot(page: any, name: string, full = false) {
  n++;
  await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: full });
  await overflow(page, name);
}

// ---------- landing at several widths + lab perf ----------
for (const w of [360, 390, 768, 1280]) {
  const { ctx, page } = await newPage(w, w < 700 ? 800 : 900);
  await page.goto(base + '/', { waitUntil: 'load' });
  await overflow(page, `landing@${w}`);
  if (w === 390) {
    await shot(page, 'landing-390');
    const perf = await page.evaluate(() => new Promise<any>((resolve) => {
      let lcp = 0; let cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      setTimeout(() => resolve({ lcp: Math.round(lcp), cls: Number(cls.toFixed(3)), bytes: performance.getEntriesByType('resource').reduce((s: number, r: any) => s + (r.transferSize || 0), 0) + ((performance.getEntriesByType('navigation')[0] as any)?.transferSize || 0) }), 1200);
    }));
    console.log(`lab (no throttling) landing@390: LCP ${perf.lcp}ms, CLS ${perf.cls}, transfer ${Math.round(perf.bytes / 1024)} KB`);
  }
  if (w === 1280) await shot(page, 'landing-1280');
  await ctx.close();
}

// Throttled run (Slow 4G-ish + 4x CPU) via CDP
{
  const { ctx, page } = await newPage(390);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(base + '/', { waitUntil: 'load' });
  const lcp = await page.evaluate(() => new Promise<number>((resolve) => {
    let v = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    setTimeout(() => resolve(Math.round(v)), 1500);
  }));
  console.log(`lab (throttled: 150ms RTT, 1.6 Mbps, 4x CPU) landing@390: LCP ${lcp}ms`);
  await page.goto(base + '/start', { waitUntil: 'load' });
  const lcp2 = await page.evaluate(() => new Promise<number>((resolve) => {
    let v = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    setTimeout(() => resolve(Math.round(v)), 1500);
  }));
  console.log(`lab (throttled) /start@390: LCP ${lcp2}ms`);
  await ctx.close();
}

// ---------- full journey at 390 ----------
const { ctx, page } = await newPage(390);
await page.goto(base + '/', { waitUntil: 'load' });
await page.getByRole('link', { name: 'Find my business' }).first().click();
await page.waitForURL('**/start');
await page.getByLabel('Paste your Google Maps link, website, or business name.').fill('Sparkle Clean');
await page.getByRole('button', { name: 'Find my business' }).click();
await page.getByLabel('City or area').waitFor();
await shot(page, 'intake-needs-location');
await page.getByLabel('City or area').fill('Toronto');
await page.getByRole('button', { name: 'Find my business' }).click();
await page.waitForURL('**/confirm');
await page.getByText('Which one is yours?').waitFor();
await shot(page, 'confirm-multiple');
// Wrong match path: reject and search the right business
await page.getByRole('button', { name: /None of these/ }).click();
await page.waitForURL('**/start**');
await page.getByLabel('Paste your Google Maps link, website, or business name.').fill('sundaycleaning.example');
await page.getByRole('button', { name: 'Find my business' }).click();
await page.waitForURL('**/confirm');
await page.getByText('Is this your business?').waitFor();
await page.waitForLoadState('networkidle');
await shot(page, 'confirm-single');
await shot(page, 'confirm-single-full', true);
await page.getByRole('button', { name: 'Yes, that’s my business' }).click();
await page.waitForURL('**/details**');
await shot(page, 'details-1');
await smallTargets(page, 'details-1');
await page.getByRole('button', { name: 'Window cleaning' }).click();
await page.getByLabel('Add a city or neighbourhood').fill('The Beaches');
await page.getByRole('button', { name: 'Add' }).nth(1).click();
// Refresh mid-form: draft must survive
await page.reload();
await page.getByRole('button', { name: 'Window cleaning' }).waitFor();
if ((await page.getByRole('button', { name: 'Window cleaning' }).getAttribute('aria-pressed')) !== 'true') problems.push('details draft lost after refresh (service)');
if (!(await page.getByRole('button', { name: /The Beaches/ }).count())) problems.push('details draft lost after refresh (area)');
await page.getByRole('button', { name: 'Next' }).click();
await page.waitForURL('**step=2**');
await page.getByLabel('Business phone').waitFor();
await shot(page, 'details-2');
await page.getByRole('button', { name: 'Next' }).click();
await page.waitForURL('**step=3**');
await page.getByText('Logo and photos').waitFor();
await page.locator('#up-photos input[type=file]').first().setInputFiles(join(process.cwd(), 'web/assets/examples/editorial.jpg'));
await page.locator('#up-photos .thumb img[alt="Uploaded image"], #up-photos .thumb img:not([alt="Uploading image"])').first().waitFor({ timeout: 10000 });
await shot(page, 'details-3-upload');
await page.getByRole('button', { name: 'Looks good, build my preview' }).click();
await page.waitForURL('**/build');
await page.getByText('Want a message when it’s ready?').waitFor();
await shot(page, 'build-progress');
await page.getByRole('button', { name: 'Email me' }).click();
await page.getByLabel('Email address').fill('owner@mail.example');
await page.getByRole('button', { name: 'Send me a code' }).click();
const code = await page.locator('#code-msg .code').innerText();
await shot(page, 'notify-code');
await page.getByLabel('6-digit code').fill(code);
await page.getByRole('button', { name: 'Verify' }).click();
await page.getByText('We’ll email you').waitFor();
// Interrupted session: close the tab mid-build and come back
await page.goto(base + '/app', { waitUntil: 'load' });
await page.goBack();
await page.getByRole('heading', { name: 'Your preview is ready' }).waitFor({ timeout: 60000 });
await shot(page, 'build-ready');
await page.getByRole('link', { name: 'See my designs' }).first().click();
await page.waitForURL('**/designs');
await page.frameLocator('iframe').first().locator('h1').waitFor();
await shot(page, 'designs-a');
await page.getByRole('tab', { name: /B · Editorial/ }).click();
await page.frameLocator('iframe').first().locator('h1').waitFor();
await shot(page, 'designs-b');
// Preview form must not send
await page.frameLocator('iframe').first().getByRole('button', { name: 'Request a quote' }).click();
if (!(await page.frameLocator('iframe').first().getByText('Preview only').isVisible())) problems.push('preview form did not show preview-only notice');
await page.getByRole('button', { name: 'Full screen' }).click();
await page.locator('.fullscreen iframe').waitFor();
await shot(page, 'designs-fullscreen');
await page.getByRole('button', { name: '← Back' }).click();
await page.getByRole('button', { name: 'Choose Editorial' }).click();
await page.waitForURL('**/site');
await page.getByRole('heading', { name: /-page website/ }).waitFor({ timeout: 60000 });
await shot(page, 'site-ready');
await page.getByRole('button', { name: 'Services' }).click();
await page.frameLocator('iframe').first().getByRole('heading', { name: 'Services' }).waitFor();
await shot(page, 'site-services');
await page.getByRole('link', { name: 'Edit website' }).click();
await page.waitForURL('**/edit');
await page.getByLabel('Headline').fill('Thoughtful home cleaning in East Toronto');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.getByText(/Saved as version/).waitFor();
await shot(page, 'edit-saved');
await page.getByLabel('Your request').fill('Please add a short FAQ about pets.');
await page.getByRole('button', { name: 'Send request' }).click();
await page.getByText('Your requests').waitFor();
await page.getByRole('button', { name: 'Restore' }).first().click();
await page.locator('dialog [data-yes]').click();
await page.getByText(/Restored version/).first().waitFor();
await shot(page, 'edit-history', true);
await page.goto(base + page.url().replace(base, '').replace('/edit', '/launch'));
await page.getByRole('heading', { name: 'Review and launch' }).waitFor();
await shot(page, 'launch-review');
await page.getByText('These business details are correct.').click();
await page.getByText('I approve publishing this website').click();
await page.getByRole('button', { name: 'Continue to simulated checkout' }).click();
await page.waitForURL('**/demo/checkout/**');
await shot(page, 'checkout-simulated');
await page.getByRole('button', { name: 'Simulate a declined card' }).click();
await page.getByText('The payment didn’t go through.').waitFor();
await shot(page, 'checkout-failed');
await page.getByRole('button', { name: 'Continue to simulated checkout' }).click();
await page.waitForURL('**/demo/checkout/**');
await page.getByRole('button', { name: 'Simulate successful payment' }).click();
await page.getByRole('heading', { name: /Your website is live|Publishing your website|Subscription active/ }).waitFor();
await page.getByRole('heading', { name: 'Your website is live' }).waitFor({ timeout: 30000 });
await page.getByLabel('Your domain').fill('sundaycleaning.example');
await page.getByRole('button', { name: 'Connect my domain' }).click();
await page.getByText('Waiting for DNS').waitFor();
await shot(page, 'launch-live-domain', true);
// Live site + inquiry
const liveHref = await page.getByRole('link', { name: 'Open my website' }).getAttribute('href');
const visitor = await newPage(390);
await visitor.page.goto(base + liveHref + 'contact', { waitUntil: 'load' });
await overflow(visitor.page, 'live-contact');
await visitor.page.getByLabel('Your name').fill('Test Visitor');
await visitor.page.getByLabel('Phone').fill('416 555 0100');
await visitor.page.getByLabel('Preferred timing').fill('Friday morning');
await visitor.page.getByRole('button', { name: 'Request a quote' }).click();
await visitor.page.getByText('Your request was sent').waitFor();
await visitor.ctx.close();
await page.getByRole('link', { name: 'Go to my dashboard' }).click();
await page.waitForURL('**/app**');
await page.getByText('Waiting for you').waitFor();
await shot(page, 'dashboard-home');
await smallTargets(page, 'dashboard');
await page.getByRole('link', { name: 'Inquiries' }).click();
await page.getByText('Test Visitor').waitFor();
await shot(page, 'dashboard-inquiries');
await page.getByRole('link', { name: 'Account' }).click();
await page.getByText('Billing').first().waitFor();
await shot(page, 'dashboard-account', true);
await ctx.close();

// ---------- other widths: key screens ----------
for (const w of [360, 768, 1280]) {
  const { ctx: c2, page: p2 } = await newPage(w, 900);
  for (const path of ['/start', '/signin', '/admin']) {
    await p2.goto(base + path, { waitUntil: 'networkidle' });
    await overflow(p2, `${path}@${w}`);
  }
  await c2.close();
}

// ---------- admin ----------
{
  const { ctx: c3, page: p3 } = await newPage(1280, 900);
  await p3.goto(base + '/admin', { waitUntil: 'networkidle' });
  await p3.getByRole('button', { name: 'Enter demo admin' }).click();
  await p3.getByRole('heading', { name: 'Queue' }).waitFor();
  await shot(p3, 'admin-queue');
  await p3.locator('table a').first().click();
  await p3.getByText('Source snapshots').waitFor();
  await shot(p3, 'admin-detail', true);
  await c3.close();
}

await browser.close();
app.worker.stop();
app.server.close();
console.log(`\nScreenshots: ${OUT}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('UI check passed: no console errors, no 5xx, no horizontal overflow, journey completed.');
process.exit(0);
