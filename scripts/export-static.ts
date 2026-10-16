// Static export for hosts that can't run the Node server (e.g. Netlify).
// Produces dist-static/: the landing page, full sample sites for the fictional
// Sunday Cleaning in both designs, and a screenshot walkthrough of the real app.
// The interactive journey (lookup, build, checkout, dashboard) needs the server.
import { mkdirSync, writeFileSync, cpSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createApp } from '../server/app.ts';
import { renderLanding } from '../server/pages/landing.ts';
import { buildContent, renderPage, sitePages, VARIANTS, esc, type Variant } from '../server/services/sitegen.ts';
import { BRAND_CSS, LOGO_SVG } from '../server/pages/brand.ts';

const OUT = join(process.cwd(), 'dist-static');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const write = (rel: string, body: string) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};

const STATIC_BAR = '<div class="demo-bar" role="note"><strong>Static preview.</strong> Sample sites and screenshots of a fictional business. The interactive app (find your business, live build, checkout) runs on the Blue Park server.</div>';

// Landing page (rendered by the real server code, then pointed at static pages).
const { ctx } = createApp({ mode: 'demo', dbFile: ':memory:', quiet: true });
let landing = renderLanding(ctx)
  .replace(/<div class="demo-bar"[\s\S]*?<\/div>/, STATIC_BAR)
  .replaceAll('href="/start"', 'href="/walkthrough/"')
  .replace('<nav aria-label="Account"><a href="/signin">Sign in</a></nav>', '<nav aria-label="Samples"><a href="/sites/bright/">Sample site</a></nav>');
landing = landing.replace(
  '<div class="examples">',
  '<p style="margin:0 0 14px"><a href="/sites/bright/">Open the Bright sample site</a> · <a href="/sites/editorial/">Open the Editorial sample site</a></p><div class="examples">',
);
write('index.html', landing);

// Full sample sites from the real template engine.
const facts: any = {
  displayName: 'Sunday Cleaning', publicPhone: '+14165550142', publicEmail: 'hello@sundaycleaning.example', city: 'Toronto',
  services: ['Recurring cleaning', 'Deep cleaning', 'Move-in / move-out cleaning', 'Apartment & condo cleaning'],
  areas: ['Toronto', 'East York', 'Leslieville', 'Riverdale', 'The Danforth'],
  description: 'Sunday Cleaning is a small Toronto team cleaning houses, condos and apartments.', mainAction: 'quote',
};
const slugOf: Record<Variant, string> = { a: 'bright', b: 'editorial' };
for (const v of ['a', 'b'] as Variant[]) {
  const content = buildContent(facts, { variant: v, assets: [], ownerKeys: new Set(['description']) });
  for (const pg of sitePages(content)) {
    const html = renderPage(content, {
      page: pg.slug, mode: 'preview', scope: 'site',
      link: (s) => `/sites/${slugOf[v]}/${s ? s + '/' : ''}`,
      inquiryAction: '#',
      previewBanner: `Sample site for a fictional business · ${VARIANTS[v].name} design · forms don’t send`,
    });
    write(`sites/${slugOf[v]}/${pg.slug ? pg.slug + '/' : ''}index.html`, html);
  }
}

// Walkthrough of the real app, from browser screenshots (npm run ui:check).
const SHOTS: [string, string, string][] = [
  ['01-landing-390', 'Landing page', 'Clear promise, monthly price, no setup fee, one main button.'],
  ['05-confirm-single', 'Is this your business?', 'What we found, where it came from and when. Nothing is built until the owner confirms.'],
  ['07-details-1', 'Anything to add or correct?', 'Prefilled details in three short steps. Owner corrections always win.'],
  ['10-build-progress', 'Live build progress', 'Each stage is tied to a real step in the build. Optional text or email when it’s ready.'],
  ['13-designs-a', 'Design A: Bright', 'Two homepage directions from the same facts. One at a time on a phone.'],
  ['14-designs-b', 'Design B: Editorial', 'A different layout and type style, not just a different colour.'],
  ['16-site-ready', 'Full site preview', 'Up to five pages, built after the owner picks a design.'],
  ['20-launch-review', 'Review and launch', 'Monthly price, tax, renewal and cancellation shown before checkout.'],
  ['24-dashboard-home', 'Owner dashboard', 'Is my site live? Any quote requests? Anything waiting for me?'],
  ['27-admin-queue', 'Operations queue', 'Exceptions, reviews and retries, handled in scheduled blocks.'],
];
const shotDir = join(process.cwd(), 'docs', 'screens');
mkdirSync(join(OUT, 'walkthrough'), { recursive: true });
for (const [f] of SHOTS) if (existsSync(join(shotDir, `${f}.png`))) cpSync(join(shotDir, `${f}.png`), join(OUT, 'walkthrough', `${f}.png`));
write('walkthrough/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Blue Park | How it works</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><style>${BRAND_CSS}
main{max-width:1120px;margin:0 auto;padding:16px 16px 48px}h1{font-size:clamp(30px,8vw,46px);line-height:1.1;margin:16px 0 8px}
.grid{display:grid;gap:22px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin-top:24px}
figure{margin:0;background:#fff;border:1px solid var(--line);border-radius:20px;padding:10px}
figure img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid var(--line)}
figcaption{padding:10px 4px 4px}figcaption strong{display:block;font-size:18px}figcaption span{color:var(--muted);font-size:15px}
</style></head><body>${STATIC_BAR}
<main><a class="logo" href="/">${LOGO_SVG}Blue Park</a>
<h1>How Blue Park works</h1><p style="color:var(--muted);font-size:18px;max-width:40em;margin:0">Screenshots of the real app at phone size, using the fictional Sunday Cleaning. Or open the sample sites: <a href="/sites/bright/">Bright</a> · <a href="/sites/editorial/">Editorial</a>.</p>
<div class="grid">${SHOTS.filter(([f]) => existsSync(join(shotDir, `${f}.png`))).map(([f, t, d], i) => `<figure><img src="/walkthrough/${f}.png" alt="${esc(t)} screen" width="390" height="844" loading="${i < 2 ? 'eager' : 'lazy'}"><figcaption><strong>${i + 1}. ${esc(t)}</strong><span>${esc(d)}</span></figcaption></figure>`).join('')}</div>
</main></body></html>`);

cpSync(join(process.cwd(), 'web', 'assets'), join(OUT, 'assets'), { recursive: true });
write('_headers', `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/sites/*\n  X-Robots-Tag: noindex\n`);
const count = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
console.log(`dist-static: ${count(OUT)} files`);
process.exit(0);
