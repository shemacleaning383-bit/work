import { api, html, navigate, busy, toast, confirmSheet, ApiError, fieldError, uid, timeAgo, dateLong, raw, type Safe } from '../lib.ts';
import { chrome, root, nextPath, type AppConfig } from '../main.ts';
import { openNotifySheet } from './notify.ts';
import { domainPanel, bindDomain } from './launch.ts';
import type { ProjectView, InquiryView, TicketView } from '../../../shared/types.ts';
import { formatPhone } from '../../../shared/validate.ts';

interface Me { signedIn: boolean; isAdmin: boolean; contact: { kind: string; masked: string } | null; projects: { id: string; name: string; status: string; updatedAt: string }[] }

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M4 14h5l1 2h4l1-2h5"/></svg>',
  site: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
};

const STATUS_TEXT: Record<string, [string, string]> = {
  draft: ['Preview not started', 'Confirm your business to begin.'], queued: ['Preview queued', 'Your build starts shortly.'],
  researching: ['Preview in progress', 'We’re gathering your details.'], building: ['Preview in progress', 'Preparing two designs.'],
  needs_info: ['We need a detail', 'Add the missing info to continue.'], in_review: ['Preview in review', 'A quick team check before we send it.'],
  directions_ready: ['Preview ready', 'Choose one of two designs.'], site_building: ['Building your full site', 'This takes a few minutes.'],
  site_ready: ['Full site ready', 'Review and launch when you’re ready.'], paid: ['Subscribed, launching soon', 'We’re getting your site live.'],
  launching: ['Publishing', 'Your site is going live.'], live: ['Your site is live', ''], failed: ['Something went wrong', 'Our team is on it.'],
  cancelled: ['Cancelled', 'This site is no longer hosted.'],
};

function tabbar(pid: string, current: string): Safe {
  const items: [string, string, string][] = [['', 'Home', ICONS.home], ['inquiries', 'Inquiries', ICONS.inbox], ['website', 'Website', ICONS.site], ['account', 'Account', ICONS.user]];
  return html`<nav class="tabbar" aria-label="Dashboard">${items.map(([k, l, i]) => html`<a href="/app${k ? '/' + k : ''}?p=${pid}" data-link ${current === k ? 'aria-current="page"' : ''}>${raw(i)}<span>${l}</span></a>`)}</nav>`;
}

export async function renderDashboard(cfg: AppConfig, path: string) {
  const tab = path.replace(/^\/app\/?/, '').split('/')[0];
  const me = await api<Me>('GET', '/api/me');
  const pid = new URLSearchParams(location.search).get('p') ?? me.projects[0]?.id;
  if (!pid) {
    root().innerHTML = chrome(cfg, html`<h1>Your dashboard</h1>
<div class="card empty"><p><strong>No website yet.</strong></p><p>Start a free preview. It takes about two minutes.</p>
<a class="btn btn-primary btn-block" href="/start" data-link>Find my business</a></div>
${me.signedIn ? '' : html`<p class="muted" style="text-align:center">Already started? <a href="/signin" data-link>Sign in</a></p>`}`).s;
    return;
  }
  let v: ProjectView;
  try {
    v = await api<ProjectView>('GET', `/api/projects/${pid}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return navigate('/signin', true);
    throw e;
  }
  const switcher = me.projects.length > 1 ? html`<label class="small muted" for="proj">Business</label><select id="proj" class="input" style="margin-bottom:12px">${me.projects.map((p) => html`<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${p.name}</option>`)}</select>` : '';
  const bindSwitcher = () => document.getElementById('proj')?.addEventListener('change', (e) => navigate(`/app${tab ? '/' + tab : ''}?p=${(e.target as HTMLSelectElement).value}`));
  const page = (body: Safe) => {
    root().innerHTML = chrome(cfg, html`${switcher}${body}`).s + tabbar(pid, tab).s;
    bindSwitcher();
  };

  if (tab === 'inquiries') return renderInquiries(v, page);
  if (tab === 'account') return renderAccount(cfg, v, me, page);
  if (tab === 'website') {
    page(html`<h1>Website</h1>
<div class="card"><p style="margin:0 0 6px"><strong>${STATUS_TEXT[v.status][0]}</strong></p>
${v.liveUrl ? html`<a class="btn btn-primary btn-block" href="${v.liveUrl}" target="_blank" rel="noopener">Open live site${v.liveIsSimulated ? ' (demo hosting)' : ''}</a>` : ''}
${v.sitePages.length ? html`<a class="btn btn-quiet btn-block" style="margin-top:8px" href="/p/${v.id}/site" data-link>Preview all pages</a>` : html`<a class="btn btn-quiet btn-block" style="margin-top:8px" href="${nextPath(v)}" data-link>Continue</a>`}</div>
<ul class="list card" style="margin-top:14px;padding:4px 16px">
<li><a href="/p/${v.id}/edit" data-link><span>Edit text, contact, services, photos</span><span class="chev"></span></a></li>
<li><a href="/p/${v.id}/edit#request" data-link><span>Request a change</span><span class="chev"></span></a></li>
<li><a href="/p/${v.id}/edit" data-link><span>Version history (${v.siteVersions.filter((s) => s.status !== 'proposed' && s.status !== 'rejected').length})</span><span class="chev"></span></a></li>
</ul>
${v.changeRequests.length ? html`<h2 style="margin-top:20px">Requests</h2><ul class="list">${v.changeRequests.slice(0, 5).map((c) => html`<li><div class="row-item"><span>${c.message.slice(0, 60)}</span><span class="badge">${c.status.replace('_', ' ')}</span></div></li>`)}</ul>` : ''}`);
    return;
  }

  // Home: Is my site live? Do I have inquiries? Is anything waiting for me?
  let inquiries: InquiryView[] = [];
  try {
    inquiries = await api<InquiryView[]>('GET', `/api/projects/${v.id}/inquiries`);
  } catch {
    /* show empty */
  }
  const newInq = inquiries.filter((i) => i.status === 'new');
  const waiting: [string, string][] = [];
  for (const c of v.changeRequests.filter((x) => x.status === 'proposed')) waiting.push([`Review a proposed change: “${c.message.slice(0, 40)}”`, `/p/${v.id}/edit`]);
  if (v.status === 'needs_info') waiting.push(['Add missing business details', `/p/${v.id}/details`]);
  if (v.status === 'directions_ready') waiting.push(['Choose your design', `/p/${v.id}/designs`]);
  if (v.status === 'site_ready') waiting.push(['Review your plan and launch', `/p/${v.id}/launch`]);
  if (['payment_failed', 'past_due'].includes(v.subscription.status)) waiting.push(['Payment didn’t go through. Update it', `/p/${v.id}/launch`]);
  if (v.domain.mode === 'custom' && v.domain.status !== 'verified') waiting.push([`Finish connecting ${v.domain.domain}`, `/app/account?p=${v.id}#domain`]);
  if (['paid', 'live'].includes(v.status) && v.domain.mode === 'none') waiting.push(['Choose your website address', `/app/account?p=${v.id}#domain`]);
  if (v.notifications.some((n) => n.status === 'failed')) waiting.push(['We couldn’t reach you. Update your contact', `/app/account?p=${v.id}#notify`]);
  if (!v.hasSavedAccess) waiting.push(['Save your access to return from any device', `/app/account?p=${v.id}#notify`]);
  const [title, sub] = STATUS_TEXT[v.status];
  page(html`
<section class="status-hero" aria-labelledby="st"><p class="small" style="margin:0 0 4px;opacity:.85">${v.businessName}</p>
<h1 id="st" style="color:#fff;margin:0 0 6px">${title}</h1>
${v.status === 'live' && v.liveIsSimulated ? html`<span class="badge">Demo hosting, not public</span>` : sub ? html`<p style="margin:0;opacity:.9">${sub}</p>` : ''}
${v.liveUrl ? html`<a class="btn btn-primary btn-block" href="${v.liveUrl}" target="_blank" rel="noopener">Open my website</a>` : v.status !== 'cancelled' ? html`<a class="btn btn-primary btn-block" href="${nextPath(v)}" data-link>${v.status === 'directions_ready' ? 'See my designs' : v.status === 'site_ready' ? 'Review & launch' : 'Open'}</a>` : ''}
</section>
<section class="card" style="margin-top:14px" aria-labelledby="wt"><h2 id="wt">Waiting for you</h2>
${waiting.length ? html`<ul class="list">${waiting.map(([t, href]) => html`<li><a href="${href}" data-link><span>${t}</span><span class="chev"></span></a></li>`)}</ul>` : html`<p class="muted" style="margin:0">Nothing right now.</p>`}</section>
<section class="card" style="margin-top:14px" aria-labelledby="iq"><div style="display:flex;justify-content:space-between;align-items:center"><h2 id="iq" style="margin:0">Quote requests</h2>${newInq.length ? html`<span class="badge blue">${newInq.length} new</span>` : ''}</div>
${inquiries.length ? html`<ul class="list">${inquiries.slice(0, 3).map((i) => html`<li><a href="/app/inquiries?p=${v.id}" data-link><span>${i.name}<br><span class="small muted">${i.service ?? 'General'} · ${timeAgo(i.createdAt)}</span></span><span class="badge ${i.status === 'new' ? 'blue' : ''}">${i.status}</span></a></li>`)}</ul>`
    : html`<p class="muted" style="margin:6px 0 0">${v.status === 'live' ? 'No requests yet. When a customer sends the quote form on your site, it appears here.' : 'Once your site is live, quote requests from customers appear here.'}</p>`}</section>
<ul class="list card" style="margin-top:14px;padding:4px 16px">
<li><a href="/p/${v.id}/edit" data-link><span>Edit website</span><span class="chev"></span></a></li>
<li><a href="/p/${v.id}/edit#request" data-link><span>Request a change</span><span class="chev"></span></a></li>
<li><a href="/app/account?p=${v.id}" data-link><span>Billing, domain &amp; notifications</span><span class="chev"></span></a></li>
<li><a href="/app/account?p=${v.id}#support" data-link><span>Support</span><span class="chev"></span></a></li>
</ul>`);
}

function renderInquiries(v: ProjectView, page: (b: Safe) => void) {
  const load = async () => {
    const list = await api<InquiryView[]>('GET', `/api/projects/${v.id}/inquiries`).catch(() => [] as InquiryView[]);
    page(html`<h1>Quote requests</h1>
<p class="muted">Requested times are requests only, not confirmed bookings. Contact the customer to confirm.</p>
${list.length ? list.map((i) => html`<article class="card" aria-label="Request from ${i.name}">
<div style="display:flex;justify-content:space-between;gap:10px"><h2 style="margin:0">${i.name}</h2><span class="small muted">${timeAgo(i.createdAt)}</span></div>
<dl class="kv" style="margin-top:8px">${i.service ? html`<dt>Service</dt><dd>${i.service}</dd>` : ''}${i.area ? html`<dt>Area</dt><dd>${i.area}</dd>` : ''}
${i.propertyDetails ? html`<dt>Home</dt><dd>${i.propertyDetails}</dd>` : ''}${i.preferredTiming ? html`<dt>Requested time</dt><dd>${i.preferredTiming}</dd>` : ''}${i.message ? html`<dt>Message</dt><dd>${i.message}</dd>` : ''}</dl>
<div class="chips" style="margin-top:10px">${i.phone ? html`<a class="chip" href="tel:${i.phone}">Call ${formatPhone(i.phone)}</a>` : ''}${i.email ? html`<a class="chip" href="mailto:${i.email}">Email</a>` : ''}</div>
<div class="chips" role="group" aria-label="Status" style="margin-top:8px">${(['new', 'read', 'contacted', 'closed'] as const).map((s) => html`<button class="chip" data-inq="${i.id}" data-s="${s}" aria-pressed="${i.status === s}">${s[0].toUpperCase() + s.slice(1)}</button>`)}</div>
</article>`) : html`<div class="card empty"><p><strong>No quote requests yet.</strong></p><p>${v.status === 'live' ? 'When a customer fills in the form on your site, you’ll see it here.' : 'Requests start arriving once your site is live.'}</p></div>`}`);
    document.querySelectorAll<HTMLButtonElement>('[data-inq]').forEach((b) => b.addEventListener('click', async () => {
      await busy(b, '…', () => api('PATCH', `/api/projects/${v.id}/inquiries/${b.dataset.inq}`, { status: b.dataset.s })).catch(() => null);
      void load();
    }));
  };
  void load();
}

async function renderAccount(cfg: AppConfig, v0: ProjectView, me: Me, page: (b: Safe) => void) {
  let v = v0;
  const tickets = await api<TicketView[]>('GET', `/api/projects/${v.id}/tickets`).catch(() => [] as TicketView[]);
  const ticketKey = uid();
  const sub = v.subscription;
  const paint = () => {
    page(html`<h1>Account</h1>
<section class="card" id="billing"><h2>Billing</h2>
${sub.status === 'none' || sub.status === 'checkout_open' ? html`<p class="muted" style="margin:0">No subscription yet. Your preview is free.</p>`
    : html`<p style="margin:0 0 8px"><strong>${sub.status === 'active' ? 'Active' : sub.status === 'cancel_scheduled' ? 'Cancels at period end' : sub.status === 'past_due' ? 'Payment overdue' : sub.status === 'payment_failed' ? 'Payment failed' : 'Cancelled'}</strong>
${sub.simulated ? html` <span class="badge sample">Simulated</span>` : ''}</p>
${sub.currentPeriodEnd ? html`<p class="muted small" style="margin:0 0 10px">${sub.status === 'cancel_scheduled' ? 'Site stays live until' : 'Next renewal'} ${dateLong(sub.currentPeriodEnd)} · ${cfg.offer.currency} $${(cfg.offer.monthlyPriceCents / 100).toFixed(0)}/month plus tax</p>` : ''}
${sub.status === 'active' ? html`<button class="btn btn-danger btn-block" id="cancel-sub">Cancel subscription</button>` : ''}
${sub.status === 'cancel_scheduled' ? html`<button class="btn btn-quiet btn-block" id="resume-sub">Keep my subscription</button>` : ''}`}
</section>
<section class="card" id="domain"><h2>Website address</h2>${['paid', 'launching', 'live'].includes(v.status) ? domainPanel(v) : html`<p class="muted" style="margin:0">You’ll connect a domain after you subscribe.</p>`}</section>
<section class="card" id="notify"><h2>Notifications &amp; access</h2>
${v.notification.verified ? html`<p style="margin:0 0 8px">Updates go to <strong>${v.notification.destinationMasked}</strong> by ${v.notification.channel === 'sms' ? 'text' : 'email'}.</p>` : html`<p class="muted" style="margin:0 0 8px">Not saved yet. Save an email or phone so you can sign in from any device and get updates.</p>`}
${v.notifications.filter((n) => n.status === 'failed').slice(0, 1).map((n) => html`<p class="notice error small">Last message to ${n.destinationMasked} failed. Please update it.</p>`)}
<div class="chips"><button class="chip" data-ch="email">${v.notification.channel === 'email' ? 'Change email' : 'Use email'}</button><button class="chip" data-ch="sms">${v.notification.channel === 'sms' ? 'Change number' : 'Use text messages'}</button></div>
${me.contact ? html`<p class="small muted">Signed in as ${me.contact.masked}.</p>` : ''}
<button class="btn-link" id="signout">Sign out on this device</button></section>
<section class="card" id="support"><h2>Support</h2>
<p class="muted small" style="margin-top:0">Ask us anything. We reply in your dashboard${v.notification.verified ? ' and by ' + (v.notification.channel === 'sms' ? 'text' : 'email') : ''}, usually within ${cfg.offer.supportResponseBusinessDays} business day. Prefer a quick call? Ask here and we’ll schedule one. A call is never required.</p>
<form id="ticket" novalidate><div class="field"><label for="t-sub">Subject</label><input class="input" id="t-sub" name="subject" maxlength="140"></div>
<div class="field"><label for="t-body">Message</label><textarea class="input" id="t-body" name="body" rows="3" maxlength="4000"></textarea></div>
<button class="btn btn-dark btn-block" type="submit">Send</button></form>
${tickets.length ? html`<ul class="list" style="margin-top:12px">${tickets.map((t) => html`<li><div class="row-item" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${t.subject}</strong><span class="badge ${t.status === 'answered' ? 'ok' : ''}">${t.status}</span></div>
<p class="small" style="margin:4px 0">${t.body}</p>${t.replies.map((r) => html`<p class="small ${r.from === 'team' ? '' : 'muted'}" style="margin:4px 0;padding-left:10px;border-left:3px solid ${r.from === 'team' ? 'var(--blue)' : 'var(--line)'}">${r.from === 'team' ? 'Blue Park' : 'You'}: ${r.body}</p>`)}</div></li>`)}</ul>` : ''}
</section>
${v.status !== 'live' && v.status !== 'cancelled' && !['paid', 'launching'].includes(v.status) ? html`<button class="btn-link" id="delete-preview" style="color:var(--red)">Cancel this preview</button>` : ''}`);
    bind();
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  };
  const bind = () => {
    bindDomain(v, (nv) => { v = nv; paint(); });
    document.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => b.addEventListener('click', () => openNotifySheet(v.id, b.dataset.ch as 'sms' | 'email', (nv) => { v = nv; paint(); }, { purpose: 'save' })));
    document.getElementById('signout')?.addEventListener('click', async () => {
      await api('POST', '/api/auth/signout').catch(() => null);
      location.assign('/');
    });
    document.getElementById('cancel-sub')?.addEventListener('click', async (e) => {
      const ok = await confirmSheet('Cancel your subscription?', html`<p>${cfg.offer.cancellationNote}</p><p>${cfg.offer.cancellationEffect}</p>`, 'Cancel subscription', true);
      if (!ok) return;
      const nv = await busy(e.target as HTMLButtonElement, 'Cancelling…', () => api<ProjectView>('POST', `/api/projects/${v.id}/subscription/cancel`)).catch(() => null);
      if (nv) { v = nv; toast('Your subscription will end at the end of this period.'); location.reload(); }
    });
    document.getElementById('resume-sub')?.addEventListener('click', async (e) => {
      const nv = await busy(e.target as HTMLButtonElement, 'Saving…', () => api<ProjectView>('POST', `/api/projects/${v.id}/subscription/resume`)).catch(() => null);
      if (nv) location.reload();
    });
    document.getElementById('delete-preview')?.addEventListener('click', async () => {
      const ok = await confirmSheet('Cancel this preview?', html`<p>We’ll stop work on this preview. You can start a new one later.</p>`, 'Cancel preview', true);
      if (!ok) return;
      await api('POST', `/api/projects/${v.id}/cancel`).catch((e) => toast(e.message, 'error'));
      navigate('/app');
    });
    const form = document.getElementById('ticket') as HTMLFormElement;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await busy(form.querySelector('button'), 'Sending…', () => api('POST', `/api/projects/${v.id}/tickets`, { subject: fd.get('subject'), body: fd.get('body'), idempotencyKey: ticketKey }), false);
        toast('Sent. We’ll reply here.');
        location.reload();
      } catch (err) {
        if (err instanceof ApiError && !fieldError(form, err.field, err.message)) toast(err.message, 'error');
      }
    });
  };
  paint();
}
