// Simulated checkout used only in demo mode. Collects no card details.
import { config } from '../config.ts';
import { formatMoney } from '../../shared/offer.ts';
import { esc } from '../services/sitegen.ts';
import { BRAND_CSS, LOGO_SVG } from './brand.ts';

export function renderDemoCheckout(a: { sessionId: string; status: string; businessName: string; projectId: string }) {
  const o = config.offer;
  const price = formatMoney(o.monthlyPriceCents, o.currency);
  const action = `/demo/checkout/${encodeURIComponent(a.sessionId)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Simulated checkout | Blue Park demo</title><style>${BRAND_CSS}
main{max-width:520px;margin:0 auto;padding:20px 16px 40px}
.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px;margin:16px 0}
.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}
.warn{background:var(--amber-soft);border:1px solid #f0d77a;border-radius:14px;padding:14px;color:#4a3200}
form{display:grid;gap:10px;margin-top:16px}.btn{width:100%}
.btn-fail{background:#fff;border-color:var(--red);color:var(--red)}
</style></head><body>
<main>
<a class="logo" href="/">${LOGO_SVG}Blue Park</a>
<h1 style="font-size:28px;margin:20px 0 8px">Simulated checkout</h1>
<p class="warn" role="note"><strong>Demo only.</strong> No card is collected and no one is charged. In live mode, this step is the payment provider’s secure hosted checkout.</p>
<div class="card">
<div class="row"><span>${esc(o.planName)} for ${esc(a.businessName)}</span><strong>${esc(price)}/mo</strong></div>
<div class="row"><span>Setup fee</span><strong>${esc(formatMoney(o.setupFeeCents))}</strong></div>
<div class="row"><span>Sales tax</span><span>Calculated by the payment provider in live mode</span></div>
<p style="color:var(--muted);font-size:15px;margin:12px 0 0">${esc(o.renewalNote)} ${esc(o.cancellationNote)}</p>
</div>
${a.status !== 'open' ? `<p>This checkout session is already ${esc(a.status)}.</p><a class="btn btn-dark" href="/p/${esc(a.projectId)}/launch">Back to launch</a>` : `
<form method="post" action="${action}"><input type="hidden" name="outcome" value="success"><button class="btn btn-primary" type="submit">Simulate successful payment</button></form>
<form method="post" action="${action}"><input type="hidden" name="outcome" value="fail"><button class="btn btn-fail" type="submit">Simulate a declined card</button></form>
<form method="post" action="${action}"><input type="hidden" name="outcome" value="cancel"><button class="btn btn-quiet" type="submit">Cancel and go back</button></form>`}
</main></body></html>`;
}
