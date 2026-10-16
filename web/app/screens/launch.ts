import { api, html, navigate, busy, toast, ApiError, fact, fieldError, dateLong, type Safe } from '../lib.ts';
import { chrome, root, onLeave, type AppConfig } from '../main.ts';
import type { ProjectView } from '../../../shared/types.ts';
import { formatMoney } from '../../../shared/offer.ts';
import { formatPhone } from '../../../shared/validate.ts';

export function priceTerms(cfg: AppConfig): Safe {
  const o = cfg.offer;
  return html`<div class="price-box"><div><span class="amt">${formatMoney(o.monthlyPriceCents, o.currency)}</span> <strong>/ month</strong> <span class="muted">(${o.currency})</span></div>
<ul class="small" style="padding-left:18px;margin:8px 0">
<li>No setup fee. You pay ${formatMoney(o.monthlyPriceCents, o.currency)} each month, not once.</li>
<li>${o.taxNote}</li><li>${o.renewalNote}</li><li>${o.cancellationNote}</li></ul></div>`;
}

export function domainPanel(v: ProjectView): Safe {
  const d = v.domain;
  if (d.mode === 'none') {
    return html`<div class="stack"><p class="muted" style="margin:0">${'Use a domain you already own, or start on a Blue Park address and connect yours later. We never buy domains for you.'}</p>
<form id="domain-form" novalidate><div class="field"><label for="domain">Your domain</label><input class="input" id="domain" name="domain" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="yourbusiness.ca"></div>
<button class="btn btn-dark btn-block" type="submit">Connect my domain</button></form>
<button class="btn btn-quiet btn-block" id="use-sub">Start on a Blue Park address</button>
<p class="small muted">Don’t have a domain? Buy one from any registrar (for example, a .ca or .com). You’ll own it and renew it directly. We haven’t checked whether any name is available.</p></div>`;
  }
  if (d.mode === 'subdomain') {
    return html`<p style="margin:0">Using a Blue Park address. <span class="badge ok">Ready</span></p><button class="btn-link" id="switch-custom">Connect my own domain instead</button>`;
  }
  const statusBadge: Record<string, Safe> = {
    awaiting_dns: html`<span class="badge">Waiting for DNS</span>`, verifying: html`<span class="badge blue">Checking</span>`,
    verified: html`<span class="badge ok">Verified</span>`, failed: html`<span class="badge err">Problem</span>`, not_started: html`<span class="badge">Not started</span>`,
  };
  return html`<div class="stack">
<p style="margin:0"><strong>${d.domain}</strong> ${statusBadge[d.status]} ${d.simulated ? html`<span class="badge sample">Simulated</span>` : ''}</p>
<p class="small muted" style="margin:0">SSL certificate: ${d.sslStatus === 'ready' ? 'ready' : d.sslStatus === 'pending' ? 'being issued' : 'starts after DNS is verified'}${d.lastCheckedAt ? ` · last checked ${new Date(d.lastCheckedAt).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}` : ''}</p>
${d.note ? html`<p class="notice info small" style="margin:0">${d.note}</p>` : ''}
${d.status !== 'verified' ? html`<p class="small" style="margin:0">Add these records at the company where you bought your domain:</p>
<div style="overflow-x:auto"><table class="dns"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th><span class="sr-only">Status</span></th></tr></thead><tbody>
${d.records.map((r) => html`<tr><td>${r.type}</td><td><span class="code">${r.host}</span></td><td><span class="code">${r.value}</span><br><button class="btn-link small" data-copy="${r.value}">Copy</button></td><td>${r.found === true ? '✓' : r.found === false ? html`<span class="muted">not yet</span>` : ''}</td></tr>`)}
</tbody></table></div>
<button class="btn btn-dark btn-block" id="check-dns">Check again</button>` : ''}
<div class="chips"><button class="chip" id="change-domain">Use a different domain</button><button class="chip" data-help>Need help with DNS?</button></div></div>`;
}

export function bindDomain(v: ProjectView, onView: (v: ProjectView) => void) {
  const form = document.getElementById('domain-form') as HTMLFormElement | null;
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const nv = await busy(form.querySelector('button'), 'Saving…', () => api<ProjectView>('POST', `/api/projects/${v.id}/domain`, { mode: 'custom', domain: (form.querySelector('#domain') as HTMLInputElement).value }), false);
      if (nv) onView(nv);
    } catch (err) {
      if (err instanceof ApiError) fieldError(form, 'domain', err.message);
    }
  });
  document.getElementById('use-sub')?.addEventListener('click', async (e) => {
    const nv = await busy(e.currentTarget as HTMLButtonElement, 'Saving…', () => api<ProjectView>('POST', `/api/projects/${v.id}/domain`, { mode: 'subdomain' })).catch(() => null);
    if (nv) onView(nv);
  });
  for (const id of ['switch-custom', 'change-domain']) document.getElementById(id)?.addEventListener('click', () => onView({ ...v, domain: { ...v.domain, mode: 'none' } }));
  document.getElementById('check-dns')?.addEventListener('click', async (e) => {
    const nv = await busy(e.currentTarget as HTMLButtonElement, 'Checking DNS…', () => api<ProjectView>('POST', `/api/projects/${v.id}/domain/check`)).catch(() => null);
    if (nv) { onView(nv); toast(nv.domain.status === 'verified' ? 'Domain verified.' : 'Not visible yet. DNS can take a while.'); }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy!);
      toast('Copied.');
    } catch {
      toast('Copy isn’t available here. Press and hold the value to copy it.', 'error');
    }
  }));
}

export function renderLaunch(cfg: AppConfig, initial: ProjectView) {
  let v = initial;
  const params = new URLSearchParams(location.search);
  const returned = params.get('checkout') === 'returned';
  const cancelled = params.get('checkout') === 'cancelled';
  let timer: number | undefined;
  const startedWaiting = Date.now();
  if (!['site_ready', 'paid', 'launching', 'live'].includes(v.status)) return navigate(`/p/${v.id}`, true);
  const paid = () => ['active', 'cancel_scheduled'].includes(v.subscription.status);

  const paint = () => {
    const name = fact(v, 'displayName');
    const chosen = v.variants.find((d) => d.key === v.chosenVariant);
    const waitingForWebhook = returned && !paid() && v.subscription.status !== 'payment_failed';
    let body: Safe;
    if (waitingForWebhook) {
      const slow = Date.now() - startedWaiting > 45000;
      body = html`<h1>Confirming your payment…</h1>
<p class="lede">We wait for confirmation from the payment provider before starting your subscription. This usually takes a few seconds.</p>
<div class="card"><div class="skel" style="height:16px;width:70%;margin-bottom:8px"></div><div class="skel" style="height:16px;width:40%"></div></div>
${slow ? html`<p class="notice warn">This is taking longer than usual. You can leave this page; your dashboard will show the result. You won’t be charged twice if you try again.</p>` : ''}`;
    } else if (!paid()) {
      body = html`
<h1>Review and launch</h1>
<p class="lede">Check the details below. Your subscription starts only after payment is confirmed.</p>
${cancelled ? html`<p class="notice info">Checkout was cancelled. Nothing was charged.</p>` : ''}
${v.subscription.status === 'payment_failed' ? html`<p class="notice error"><strong>The payment didn’t go through.</strong> ${v.subscription.lastError ?? ''} No subscription was started. You can try again.</p>` : ''}
<div class="card"><h2>Your website</h2>
<dl class="kv"><dt>Design</dt><dd>${chosen?.name ?? ''}</dd><dt>Pages</dt><dd>${v.sitePages.map((p) => p.title).join(', ')}</dd></dl>
<a class="btn-link" href="/p/${v.id}/site" data-link>Look again</a></div>
<div class="card"><h2>Plan</h2>${priceTerms(cfg)}
<details style="margin-top:10px"><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700">What’s included</summary>
<ul class="small" style="padding-left:18px">${cfg.offer.included.map((x) => html`<li>${x}</li>`)}</ul>
<p class="small muted">Not included: ${cfg.offer.notIncluded.join('; ').toLowerCase()}.</p>
<p class="small muted">Support: routine updates within about ${cfg.settings.updateTurnaroundBusinessDays} business days. ${cfg.offer.domainNote}</p>
<p class="small muted">If you cancel: ${cfg.offer.cancellationEffect}</p></details></div>
<form id="approve" class="card" novalidate><h2>Confirm your details</h2>
<dl class="kv"><dt>Name</dt><dd>${name}</dd><dt>Phone</dt><dd>${formatPhone(fact(v, 'publicPhone')) || 'None'}</dd><dt>Email</dt><dd>${fact(v, 'publicEmail') ?? 'None'}</dd>
<dt>Services</dt><dd>${(fact(v, 'services') ?? []).join(', ')}</dd><dt>Areas</dt><dd>${(fact(v, 'areas') ?? []).join(', ')}</dd></dl>
<a class="btn-link" href="/p/${v.id}/edit" data-link>Fix something</a>
<label class="check"><input type="checkbox" name="facts" ${v.launchApproved ? 'checked' : ''} required> <span>These business details are correct.</span></label>
<label class="check"><input type="checkbox" name="launch" ${v.launchApproved ? 'checked' : ''} required> <span>I approve publishing this website once payment is confirmed.</span></label>
</form>
<div class="actionbar"><button class="btn btn-primary btn-block" id="pay">${cfg.mode === 'demo' ? 'Continue to simulated checkout' : 'Continue to secure checkout'}</button>
<p class="hint">${cfg.mode === 'demo' ? 'Demo: no card is collected and nothing is charged.' : `You’ll enter payment details on our payment provider’s page. ${formatMoney(cfg.offer.monthlyPriceCents)}/month plus tax.`}</p></div>`;
    } else {
      const sub = v.subscription;
      const live = v.status === 'live';
      const launchEvents = v.events.filter((e) => e.stage === 'launch').slice(-4);
      body = html`
<h1>${live ? 'Your website is live' : v.status === 'launching' ? 'Publishing your website' : 'Subscription active'}</h1>
<p class="lede">${live ? (v.liveIsSimulated ? 'Published on demo hosting on this server. It isn’t on the public internet.' : 'Customers can visit your site now.') : 'Payment is confirmed. Next: your website address.'}</p>
<div class="card"><h2>Subscription</h2><p style="margin:0">${sub.status === 'cancel_scheduled' ? 'Ends' : 'Active, renews'} ${sub.currentPeriodEnd ? dateLong(sub.currentPeriodEnd) : ''} ${sub.simulated ? html`<span class="badge sample">Simulated</span>` : html`<span class="badge ok">Active</span>`}</p></div>
<div class="card"><h2>Launch status</h2>
${live && v.liveUrl ? html`<p><a class="btn btn-primary btn-block" href="${v.liveUrl}" target="_blank" rel="noopener">Open my website</a></p>` : ''}
<ul class="feed">${launchEvents.map((e) => html`<li><span></span><span class="${e.level}">${e.message}</span></li>`)}</ul></div>
<div class="card"><h2>Website address</h2>${domainPanel(v)}</div>
<div class="actionbar"><a class="btn ${live ? 'btn-primary' : 'btn-quiet'} btn-block" href="/app?p=${v.id}" data-link>Go to my dashboard</a></div>`;
    }
    root().innerHTML = chrome(cfg, body, { back: paid() ? `/app?p=${v.id}` : `/p/${v.id}/site`, backLabel: 'Back' }).s;
    bind();
  };

  const bind = () => {
    document.getElementById('pay')?.addEventListener('click', async (e) => {
      const form = document.getElementById('approve') as HTMLFormElement;
      const fd = new FormData(form);
      if (!fd.has('facts') || !fd.has('launch')) {
        toast('Please tick both boxes to continue.', 'error');
        (form.querySelector('input:not(:checked)') as HTMLInputElement)?.focus();
        return;
      }
      const btn = e.currentTarget as HTMLButtonElement;
      try {
        await busy(btn, 'Opening checkout…', async () => {
          await api('POST', `/api/projects/${v.id}/approve-launch`, { factsConfirmed: true, launchApproved: true });
          const r = await api<{ url: string }>('POST', `/api/projects/${v.id}/checkout`);
          location.assign(r.url); // hosted checkout (or labeled demo simulation)
        });
      } catch {
        /* toasted */
      }
    });
    bindDomain(v, (nv) => { v = nv; paint(); });
  };

  const poll = async () => {
    try {
      v = await api<ProjectView>('GET', `/api/projects/${v.id}`);
    } catch {
      /* keep trying */
    }
    if (!document.querySelector('dialog.sheet') && !document.activeElement?.matches('input,textarea')) paint();
    const waiting = (returned && !paid() && v.subscription.status !== 'payment_failed') || v.status === 'paid' || v.status === 'launching';
    if (waiting) timer = window.setTimeout(poll, document.hidden ? 8000 : 2000);
  };
  onLeave(() => clearTimeout(timer));
  paint();
  if ((returned && !paid()) || v.status === 'paid' || v.status === 'launching') timer = window.setTimeout(poll, 1000);
}
