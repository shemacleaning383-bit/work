import type { Ctx } from '../ctx.ts';
import { config } from '../config.ts';
import { formatMoney } from '../../shared/offer.ts';
import { getSettings } from '../services/settings.ts';
import { esc } from '../services/sitegen.ts';
import { BRAND_CSS, LOGO_SVG } from './brand.ts';

export function renderLanding(ctx: Ctx): string {
  const o = config.offer;
  const s = getSettings(ctx);
  const price = formatMoney(o.monthlyPriceCents, o.currency);
  const support = process.env.SUPPORT_EMAIL || (ctx.demo ? 'support@bluepark.example' : '');
  const days = s.previewTargetBusinessDays;
  const faq: [string, string][] = [
    ['Do I have to pay to see my website?', `No. Your preview is free and private, and we don’t ask for a card to view it. Billing starts only if you choose to subscribe and confirm payment.`],
    ['What does it cost?', `${price} per month, plus applicable sales tax, with no setup fee. ${o.renewalNote} ${o.cancellationNote}`],
    ['What can I change?', `You can edit these yourself anytime: ${o.selfServiceEdits.join(', ').toLowerCase()}. For anything else, send a request: ${o.routineUpdates.join('; ').toLowerCase()}. We aim to finish routine updates within ${s.updateTurnaroundBusinessDays} business days. Not included: ${o.outOfScope.join('; ').toLowerCase()}.`],
    ['Do I need to buy a domain?', o.domainNote + ' You can also launch on a Blue Park address first and connect your domain later.'],
    ['What if you find the wrong business?', 'You confirm the business before we build anything. If it’s wrong, tap “No, find another” and nothing from that listing is used.'],
    ['Will a new website get me more customers?', 'We can’t promise that, and neither can anyone else. We build a clear, fast, mobile-friendly site with an easy quote form and tap-to-call. Results depend on your market, reviews, pricing and how people find you.'],
    ['How is it made?', 'We read your public business listing and website, organize the details you confirm, and assemble your site from tested templates. Automatic checks cover mobile layout, tap-to-call and wording. We never invent reviews, prices, insurance or certifications.' + (s.requireLaunchReview ? ' A person reviews every site before it launches.' : '')],
    ['What happens if I cancel?', o.cancellationEffect],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Blue Park | Websites for cleaning businesses</title>
<meta name="description" content="A website for your cleaning business. See it before you pay. ${esc(price)}/month, no setup fee.">
<meta name="theme-color" content="#0b1b33">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" as="image" href="/assets/examples/hero-phone.jpg" fetchpriority="high">
<style>${BRAND_CSS}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;min-height:64px}
header.top nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;font-weight:600;color:var(--ink);text-decoration:none}
.hero{padding:20px 0 48px}
.hero-grid{display:grid;gap:28px;align-items:center}
.eyebrow{display:inline-flex;gap:8px;align-items:center;background:var(--blue-soft);color:var(--blue-ink);font-weight:700;font-size:14px;padding:6px 12px;border-radius:999px}
h1{font-size:clamp(34px,9vw,60px);line-height:1.05;letter-spacing:-.025em;margin:14px 0 14px}
.sub{font-size:19px;color:var(--muted);max-width:34em;margin:0 0 20px}
.price{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;margin:0 0 18px}
.price strong{font-size:26px}.price span{color:var(--muted)}
.cta-row{display:grid;gap:10px;max-width:420px}
.fine{font-size:15px;color:var(--muted);margin:12px 0 0}
.phone{position:relative;margin:0 auto;width:min(300px,78vw);aspect-ratio:300/610;border-radius:42px;background:var(--navy);padding:12px;box-shadow:0 30px 60px -20px rgba(11,27,51,.45)}
.phone img{display:block;width:100%;height:100%;object-fit:cover;object-position:top;border-radius:32px;background:#fff}
.tag{display:block;text-align:center;font-size:13px;color:var(--muted);margin-top:12px}
section{padding:48px 0}
h2{font-size:clamp(26px,6.5vw,40px);line-height:1.1;letter-spacing:-.02em;margin:0 0 12px}
.lead{color:var(--muted);font-size:18px;margin:0 0 24px;max-width:40em}
.steps{list-style:none;padding:0;margin:0;display:grid;gap:14px;counter-reset:s}
.steps li{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px 20px 20px 72px;position:relative;counter-increment:s}
.steps li::before{content:counter(s);position:absolute;left:20px;top:20px;width:36px;height:36px;border-radius:12px;background:var(--navy);color:#fff;font-weight:800;display:grid;place-items:center}
.steps h3{margin:0 0 4px;font-size:19px}.steps p{margin:0;color:var(--muted)}
.examples{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.examples figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:10px}
.examples img{display:block;width:100%;height:auto;border-radius:14px;aspect-ratio:390/760;object-fit:cover;object-position:top;background:#eef1f6}
.examples figcaption{font-size:14px;color:var(--muted);padding:10px 4px 2px}
.dark{background:var(--navy);color:#fff}.dark .lead{color:#c3cee0}
.how{display:grid;gap:14px;list-style:none;padding:0;margin:0}
.how li{border:1px solid rgba(255,255,255,.14);border-radius:var(--radius);padding:18px}.how strong{display:block;margin-bottom:4px}
.price-card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:24px;box-shadow:var(--shadow)}
.price-card .amount{font-size:44px;font-weight:800;letter-spacing:-.02em}.price-card .per{color:var(--muted);font-weight:600}
.checks{list-style:none;padding:0;margin:16px 0}.checks li{padding:8px 0 8px 32px;position:relative;border-bottom:1px solid var(--line)}
.checks li::before{content:"";position:absolute;left:4px;top:14px;width:14px;height:8px;border-left:3px solid var(--green);border-bottom:3px solid var(--green);transform:rotate(-45deg)}
.nots li::before{border:0;width:12px;height:3px;background:var(--line-2);transform:none;top:20px}
.terms{background:var(--paper);border-radius:14px;padding:14px 16px;font-size:15px;color:var(--muted)}
details.faq{background:var(--card);border:1px solid var(--line);border-radius:14px;margin:0 0 10px}
details.faq summary{cursor:pointer;list-style:none;padding:16px 48px 16px 18px;font-weight:700;min-height:52px;position:relative}
details.faq summary::-webkit-details-marker{display:none}
details.faq summary::after{content:"+";position:absolute;right:18px;top:12px;font-size:24px;color:var(--muted)}
details.faq[open] summary::after{content:"–"}
details.faq p{margin:0;padding:0 18px 18px;color:var(--muted)}
.final{text-align:center}.final .cta-row{margin:0 auto}
footer{padding:32px 0 48px;color:var(--muted);font-size:15px;border-top:1px solid var(--line)}
@media (min-width:860px){.hero{padding:40px 0 72px}.hero-grid{grid-template-columns:1.15fr .85fr}.cta-row{grid-auto-flow:column;justify-content:start;max-width:none}
.steps{grid-template-columns:repeat(3,1fr)}.how{grid-template-columns:repeat(2,1fr)}.pricing-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start}
.examples{grid-template-columns:repeat(2,minmax(0,300px));justify-content:start}}
</style></head><body>
${ctx.demo ? '<div class="demo-bar" role="note"><strong>Demo mode.</strong> Sample businesses only. No messages are sent and no one is charged.</div>' : ''}
<header class="top"><div class="wrap"><a class="logo" href="/">${LOGO_SVG}Blue Park</a><nav aria-label="Account"><a href="/signin">Sign in</a></nav></div></header>
<main>
<section class="hero"><div class="wrap hero-grid">
<div>
<span class="eyebrow">Built for cleaning businesses</span>
<h1>A website for your cleaning business. See it before you pay.</h1>
<p class="sub">Find your business, confirm your details, and we’ll prepare your website. No sales call required.</p>
<p class="price"><strong>${esc(price)}/month</strong><span>No setup fee · Plus applicable tax · Cancel anytime</span></p>
<div class="cta-row"><a class="btn btn-primary" href="/start">Find my business</a><a class="btn btn-quiet" href="#how">How it works</a></div>
<p class="fine">Your preview is free and private, with no card needed. Billing starts only after you choose to subscribe and confirm payment.</p>
</div>
<div><div class="phone"><img src="/assets/examples/hero-phone.jpg" width="276" height="586" alt="A mobile cleaning-business website preview for Sunday Cleaning, a fictional business" fetchpriority="high"></div>
<span class="tag">Sample site for a fictional business, built by Blue Park templates</span></div>
</div></section>

<section id="how"><div class="wrap">
<h2>Three steps. No blank page.</h2>
<p class="lead">You don’t write prompts or design layouts. You check what we found and pick what you like.</p>
<ol class="steps">
<li><h3>Find your business</h3><p>Paste your Google Maps link or website, or type your business name. Confirm it’s yours.</p></li>
<li><h3>Review your website</h3><p>We prepare two homepage designs from your details, usually within ${days} business day${days === 1 ? '' : 's'}. Choose one and see the full site.</p></li>
<li><h3>Choose to launch</h3><p>Subscribe when you’re happy. Connect a domain you own, or start on a Blue Park address.</p></li>
</ol>
</div></section>

<section><div class="wrap">
<h2>Two directions, same facts</h2>
<p class="lead">Every preview comes in two distinct layouts built from the details you confirm. Both are designed for phones first.</p>
<div class="examples">
<figure><img src="/assets/examples/bright.jpg" width="390" height="760" loading="lazy" decoding="async" alt="Bright design: large hero, service cards and a call and quote bar"><figcaption><strong>Bright</strong>: fictional sample</figcaption></figure>
<figure><img src="/assets/examples/editorial.jpg" width="390" height="760" loading="lazy" decoding="async" alt="Editorial design: serif headline and a quote form near the top"><figcaption><strong>Editorial</strong>: fictional sample</figcaption></figure>
</div>
</div></section>

<section class="dark"><div class="wrap">
<h2>How your site gets made</h2>
<p class="lead">AI-assisted research and tested templates do the heavy lifting. Rules and people keep it honest.</p>
<ul class="how">
<li><strong>We read what’s public</strong>Your listing and website, with the source and date of every detail recorded.</li>
<li><strong>You confirm the facts</strong>Your corrections always win. A later lookup never overwrites them.</li>
<li><strong>Templates, not guesswork</strong>Professionally designed layouts with fixed rules for spacing, contrast and tap targets.</li>
<li><strong>Checks before you see it</strong>Automatic checks for mobile layout, tap-to-call and invented claims${s.requireLaunchReview ? ', plus a person before launch' : ''}.</li>
</ul>
</div></section>

<section id="pricing"><div class="wrap pricing-grid">
<div>
<h2>One simple plan</h2>
<p class="lead">Everything a cleaning business needs online, without a big upfront bill.</p>
<ul class="checks nots" aria-label="Not included">${o.notIncluded.map((x) => `<li>Not included: ${esc(x)}</li>`).join('')}</ul>
</div>
<div class="price-card">
<div><span class="amount">${esc(price)}</span> <span class="per">/ month</span></div>
<p style="margin:4px 0 0;color:var(--muted)">No setup fee. Free private preview.</p>
<ul class="checks">${o.included.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<p class="terms">${esc(o.taxNote)} ${esc(o.renewalNote)} ${esc(o.cancellationNote)}</p>
<a class="btn btn-primary" style="width:100%;margin-top:12px" href="/start">Find my business</a>
</div>
</div></section>

<section><div class="wrap" style="max-width:760px">
<h2>Questions</h2>
${faq.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
${support ? `<p style="margin-top:20px">Still have a question? Email <a href="mailto:${esc(support)}">${esc(support)}</a>. We reply within ${o.supportResponseBusinessDays} business day.</p>` : ''}
</div></section>

<section class="final"><div class="wrap">
<h2>See your website first.</h2>
<p class="lead" style="margin-left:auto;margin-right:auto">It takes about two minutes to start, with no account and no card.</p>
<div class="cta-row"><a class="btn btn-primary" href="/start">Find my business</a></div>
</div></section>
</main>
<footer><div class="wrap">© Blue Park · Websites for cleaning businesses in Toronto and the GTA${support ? ` · <a href="mailto:${esc(support)}">${esc(support)}</a>` : ''}</div></footer>
</body></html>`;
}
