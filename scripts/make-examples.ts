// Renders the landing-page example images from the REAL template engine using
// the fictional Sunday Cleaning fixture, plus the clearly-labeled sample
// "existing website" screenshot used in demo confirmation.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildContent, renderPage } from '../server/services/sitegen.ts';
import { launchChromium } from './browser.ts';

const out = join(process.cwd(), 'web', 'assets');
mkdirSync(join(out, 'examples'), { recursive: true });
mkdirSync(join(out, 'demo'), { recursive: true });

const facts: any = {
  displayName: 'Sunday Cleaning', publicPhone: '+14165550142', publicEmail: 'hello@sundaycleaning.example', city: 'Toronto',
  services: ['Recurring cleaning', 'Deep cleaning', 'Move-in / move-out cleaning'], areas: ['Toronto', 'East York', 'Leslieville', 'Riverdale'],
  description: 'Sunday Cleaning is a small Toronto team cleaning houses, condos and apartments.', mainAction: 'quote',
};
const content = (variant: 'a' | 'b') => buildContent(facts, { variant, assets: [], ownerKeys: new Set(['description']) });
const page = (variant: 'a' | 'b') => renderPage(content(variant), { page: '', mode: 'preview', scope: 'direction', link: (s) => `/${s}`, inquiryAction: '#' });

// A deliberately dated "existing site" for the fictional business (sample data).
const oldSite = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font:15px Georgia,serif;background:#e9f0f7;color:#223}header{background:#2b5d8c;color:#fff;padding:14px}h1{margin:0;font-size:22px}
nav{background:#183c5e;padding:8px 14px}nav a{color:#cde;margin-right:12px;font-size:13px}main{padding:16px}
.box{background:#fff;border:1px solid #9ab;padding:12px;margin-bottom:12px}.tag{position:fixed;bottom:0;left:0;right:0;background:#ffcc00;color:#000;font:bold 12px sans-serif;text-align:center;padding:6px}
</style></head><body><header><h1>Sunday Cleaning</h1><div>Toronto home cleaning · (416) 555-0142</div></header>
<nav><a>Home</a><a>Services</a><a>Contact</a></nav><main><div class="box"><b>Welcome!</b><p>Sunday Cleaning is a small Toronto team cleaning houses, condos and apartments. Recurring cleaning, deep cleaning, move-in / move-out cleaning.</p></div>
<div class="box">Areas: Toronto, East York, Leslieville, Riverdale</div><div class="box">Email: hello@sundaycleaning.example</div></main>
<div class="tag">SAMPLE · FICTIONAL BUSINESS · DEMO DATA</div></body></html>`;

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const shots: [string, string, { width: number; height: number }][] = [
  ['examples/bright.jpg', page('a'), { width: 390, height: 760 }],
  ['examples/editorial.jpg', page('b'), { width: 390, height: 760 }],
  ['examples/hero-phone.jpg', page('a'), { width: 276, height: 586 }],
  ['demo/sunday-website.jpg', oldSite, { width: 390, height: 520 }],
];
for (const [file, htmlDoc, vp] of shots) {
  await p.setViewportSize(vp);
  await p.setContent(htmlDoc.replace(/<div class="banner-preview">.*?<\/div>/, ''), { waitUntil: 'load' });
  await p.screenshot({ path: join(out, file), type: 'jpeg', quality: 72 });
  console.log('wrote', file);
}
await browser.close();
