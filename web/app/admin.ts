// Operations queue for the founder: handle exceptions in scheduled blocks.
import { api, html, raw, esc, toast, busy, ApiError, timeAgo, type Safe } from './lib.ts';
import { formatPhone } from '../../shared/validate.ts';

const app = () => document.getElementById('app')!;
const STATUSES = ['draft', 'queued', 'researching', 'building', 'needs_info', 'in_review', 'directions_ready', 'site_building', 'site_ready', 'paid', 'launching', 'live', 'failed', 'cancelled'];
const CHECKLIST: [string, string][] = [
  ['identity', 'Business identity matches the sources'], ['claims', 'No invented claims (reviews, prices, insurance, years)'],
  ['contact', 'Public contact details are correct and not private'], ['mobile', 'Checked on a phone-sized screen'],
  ['assets', 'Images are owner-supplied or labeled illustrations'],
];

function shell(body: Safe, demo: boolean) {
  app().innerHTML = html`${demo ? html`<div class="demo-bar"><strong>Demo admin.</strong> The demo role switch is a convenience, not security. Live mode requires the admin password.</div>` : ''}
<header class="topbar"><div class="in" style="max-width:1240px"><a class="logo" href="/admin">Blue Park Ops</a><div class="grow"></div><a class="icon-btn" href="/admin/settings">Settings</a><a class="icon-btn" href="/admin/metrics">Metrics</a></div></header>
<main id="main">${body}</main>`.s;
}

async function boot() {
  const cfg = await api('GET', '/api/config');
  const demo = cfg.mode === 'demo';
  const path = location.pathname;
  const me = await api('GET', '/api/me');
  if (!me.isAdmin) return login(demo);
  try {
    if (path === '/admin/settings') return await settings(demo);
    if (path === '/admin/metrics') return await metrics(demo);
    const m = path.match(/^\/admin\/p\/([\w-]+)/);
    if (m) return await detail(m[1], demo);
    return await queue(demo);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return login(demo);
    shell(html`<p class="notice error">${(e as Error).message}</p>`, demo);
  }
}

function login(demo: boolean) {
  shell(html`<div style="max-width:420px"><h1>Operations sign in</h1>
<form id="lf" class="card"><div class="field"><label for="pw">Admin password</label><input class="input" id="pw" type="password" autocomplete="current-password"></div>
<button class="btn btn-primary btn-block">Sign in</button></form>
${demo ? html`<button class="btn btn-quiet btn-block" style="margin-top:12px" id="demo">Enter demo admin</button>` : ''}</div>`, demo);
  document.getElementById('lf')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy((e.target as HTMLFormElement).querySelector('button'), 'Signing in…', () => api('POST', '/api/admin/login', { password: (document.getElementById('pw') as HTMLInputElement).value })).then(() => location.reload()).catch(() => null);
  });
  document.getElementById('demo')?.addEventListener('click', async () => {
    await api('POST', '/api/admin/demo-login');
    location.reload();
  });
}

async function queue(demo: boolean) {
  const filter = new URLSearchParams(location.search).get('status') ?? '';
  const q = await api('GET', `/api/admin/queue${filter ? `?status=${filter}` : ''}`);
  const ex = q.exceptions;
  shell(html`<h1>Queue</h1>
<div class="kpis">
${[['Failed jobs', ex.failedJobs, 'failed'], ['Notification failures', ex.failedNotifications, ''], ['Open change requests', ex.openRequests, ''], ['Open tickets', ex.openTickets, ''], ['Billing issues', ex.billingIssues, ''], ['Awaiting launch review', ex.awaitingLaunchReview, 'paid'], ['Awaiting preview review', q.counts.in_review ?? 0, 'in_review'], ['Needs info', q.counts.needs_info ?? 0, 'needs_info']]
    .map(([l, n, s]) => html`<a class="kpi" href="/admin${s ? `?status=${s}` : ''}" style="text-decoration:none;color:inherit;${Number(n) > 0 ? 'border-color:var(--amber)' : ''}"><b>${n}</b><span class="small muted">${l}</span></a>`)}
</div>
<nav class="chips" style="margin:16px 0" aria-label="Filter by status"><a class="chip" href="/admin" aria-pressed="${!filter}">Recent</a>
${STATUSES.map((s) => html`<a class="chip" href="/admin?status=${s}" aria-pressed="${filter === s}">${s.replace('_', ' ')} (${q.counts[s] ?? 0})</a>`)}</nav>
<div style="overflow-x:auto"><table><thead><tr><th>Business</th><th>Status</th><th>Updated</th><th>Open</th><th>Manual</th></tr></thead><tbody>
${q.projects.map((p: any) => html`<tr><td><a href="/admin/p/${p.id}"><strong>${p.name}</strong></a><br><span class="small muted">${p.city ?? ''} · ${p.mode}</span></td>
<td><span class="badge ${p.status === 'failed' ? 'err' : p.status === 'live' ? 'ok' : ''}">${p.status}</span>${p.failedJobs ? html` <span class="badge err">${p.failedJobs} failed job</span>` : ''}</td>
<td>${timeAgo(p.updatedAt)}</td><td>${p.openRequests || ''}</td><td>${p.manualInterventions} · ${p.adminMinutes}m</td></tr>`)}
</tbody></table></div>
${q.projects.length ? '' : html`<p class="empty">Nothing here.</p>`}`, demo);
}

async function detail(id: string, demo: boolean) {
  const d = await api('GET', `/api/admin/projects/${id}`);
  const v = d.view;
  const checklist = d.review ?? {};
  shell(html`<p><a href="/admin">← Queue</a></p>
<h1>${v.businessName || v.intakeQuery} <span class="badge">${v.status}</span> ${v.mode === 'demo' ? html`<span class="badge sample">demo data</span>` : ''}</h1>
<p class="muted small">Project ${v.id} · contact ${d.contact ? `${d.contact.masked} (${d.contact.verified ? 'verified' : 'unverified'})` : 'not saved'} · cost ${d.costs.costCents ? `$${(d.costs.costCents / 100).toFixed(2)}` : 'none reported'} · ${d.costs.adminMinutes} admin min · ${d.costs.manualInterventions} manual actions</p>
<div class="grid2">
<section class="card"><h2>Review</h2>
${d.reviewNeeded.preview ? html`<p class="notice warn">Waiting for preview review before delivery.</p>` : ''}
${d.reviewNeeded.launch ? html`<p class="notice warn">Paid, waiting for launch review.</p>` : ''}
<form id="cl">${CHECKLIST.map(([k, l]) => html`<label class="check"><input type="checkbox" name="${k}" ${checklist[k] ? 'checked' : ''}> ${l}</label>`)}</form>
<div class="chips" style="margin-top:10px">
${v.variants.map((x: any) => html`<a class="chip" href="${x.previewUrl}" target="_blank" rel="noopener">Open preview ${x.key.toUpperCase()}</a>`)}
${d.reviewNeeded.preview ? html`<button class="btn btn-primary" id="approve-preview">Approve &amp; send preview</button>` : ''}
${d.reviewNeeded.launch ? html`<button class="btn btn-primary" id="approve-launch">Approve launch</button>` : ''}</div>
<form id="time" style="display:flex;gap:8px;margin-top:12px"><input class="input" name="minutes" inputmode="numeric" placeholder="Minutes spent" style="max-width:160px" aria-label="Minutes spent"><button class="btn btn-quiet">Log time</button></form>
</section>
<section class="card"><h2>Confirmed business</h2>
${v.candidate ? html`<p><strong>${v.candidate.name}</strong> · ${v.candidate.city} · ${v.candidate.sourceLabel} ${v.candidate.sourceUrl ? html`<a href="${v.candidate.sourceUrl}" target="_blank" rel="noopener">source</a>` : ''}</p>` : html`<p class="muted">Not confirmed.</p>`}
<table><thead><tr><th>Fact</th><th>Value</th><th>Source</th></tr></thead><tbody>
${v.facts.filter((f: any) => f.value != null && f.value !== '').map((f: any) => html`<tr><td>${f.key}</td><td>${Array.isArray(f.value) ? f.value.join(', ') : f.key === 'publicPhone' ? formatPhone(f.value) : String(f.value)}</td>
<td>${f.source === 'owner' ? html`<span class="badge ok">owner</span>` : f.sourceLabel ?? ''}${f.conflict ? html` <span class="badge err">conflict: ${f.conflict.values.map((c: any) => `${c.value} (${c.sourceLabel})`).join('; ')}</span>` : ''}</td></tr>`)}</tbody></table></section>
<section class="card"><h2>Source snapshots</h2>
${d.snapshots.map((s: any) => html`<details><summary>${s.label} · <span class="badge ${s.status === 'ok' ? 'ok' : 'err'}">${s.status}</span> ${s.is_sample ? html`<span class="badge sample">sample</span>` : ''} <span class="small muted">${timeAgo(s.fetched_at)}</span></summary>
${s.url ? html`<p class="small"><a href="${s.url}" target="_blank" rel="noopener">${s.url}</a></p>` : ''}${s.error ? html`<p class="small err-text">${s.error}</p>` : ''}
${s.screenshot_path ? html`<img src="${s.screenshot_path}" alt="Captured screenshot" style="max-width:220px;border-radius:10px" loading="lazy">` : ''}<pre>${JSON.stringify(s.summary, null, 2)}</pre></details>`)}</section>
<section class="card"><h2>Jobs</h2><table><tbody>${d.jobs.map((j: any) => html`<tr><td>${j.type}</td><td><span class="badge ${j.status === 'failed' ? 'err' : j.status === 'succeeded' ? 'ok' : ''}">${j.status}</span> ${j.attempts}/${j.max_attempts}</td>
<td class="small">${j.error ?? ''}</td><td>${j.status === 'failed' ? html`<button class="btn btn-quiet" data-retry="${j.id}">Retry this step</button>` : ''}</td></tr>`)}</tbody></table></section>
<section class="card"><h2>Quality checks (current version)</h2>
${(d.qa ?? []).length ? html`<table><tbody>${d.qa.map((r: any) => html`<tr><td>${r.page}</td><td>${r.errors.length ? html`<span class="badge err">${r.errors.join('; ')}</span>` : html`<span class="badge ok">pass</span>`}</td><td class="small muted">${r.warnings.join('; ')}</td><td class="small">${Math.round(r.bytes / 1024)} KB</td></tr>`)}</tbody></table>` : html`<p class="muted">No results yet.</p>`}</section>
<section class="card"><h2>Change requests</h2>
${v.changeRequests.length ? v.changeRequests.map((c: any) => html`<div style="border-bottom:1px solid var(--line);padding:10px 0"><p style="margin:0"><span class="badge">${c.status}</span> ${c.message}</p>
${c.attachmentUrl ? html`<p class="small"><a href="${c.attachmentUrl}" target="_blank" rel="noopener">Attachment</a></p>` : ''}
${['received', 'in_progress'].includes(c.status) ? html`<form data-propose="${c.id}" style="display:grid;gap:8px;margin-top:8px">
<input class="input" name="heroTitle" placeholder="New headline (optional)"><input class="input" name="heroSub" placeholder="New intro sentence (optional)">
<input class="input" name="services" placeholder="Replace services, comma-separated (optional)">
<textarea class="input" name="response" rows="2" placeholder="Note to the owner"></textarea>
<div class="chips"><button class="btn btn-primary" name="act" value="propose">Send proposal for approval</button><button class="btn btn-quiet" name="act" value="in_progress">Mark in progress</button><button class="btn btn-quiet" name="act" value="declined">Decline with note</button><button class="btn btn-quiet" name="act" value="done">Mark done</button></div></form>` : ''}</div>`) : html`<p class="muted">None.</p>`}</section>
<section class="card"><h2>Tickets</h2>
${d.tickets.length ? d.tickets.map((t: any) => html`<div style="border-bottom:1px solid var(--line);padding:10px 0"><p style="margin:0"><strong>${t.subject}</strong> <span class="badge">${t.status}</span></p><p class="small">${t.body}</p>
${t.replies.map((r: any) => html`<p class="small muted">${r.from}: ${r.body}</p>`)}
<form data-ticket="${t.id}" style="display:grid;gap:8px"><textarea class="input" name="body" rows="2" placeholder="Reply"></textarea><div class="chips"><button class="btn btn-quiet">Reply</button><button class="btn btn-quiet" name="close" value="1">Reply &amp; close</button></div></form></div>`) : html`<p class="muted">None.</p>`}</section>
<section class="card"><h2>Notifications &amp; billing</h2>
<table><tbody>${d.notifications.map((n: any) => html`<tr><td>${n.channel} · ${n.template}</td><td><span class="badge ${n.status === 'failed' ? 'err' : ''}">${n.status}</span></td><td class="small">${n.error ?? ''}</td><td>${n.status === 'failed' ? html`<button class="btn btn-quiet" data-resend="${n.id}">Resend</button>` : ''}</td></tr>`)}</tbody></table>
<p><strong>Subscription:</strong> ${v.subscription.status} ${v.subscription.simulated ? '(simulated)' : ''} ${v.subscription.lastError ? `· ${v.subscription.lastError}` : ''}</p>
<table><tbody>${d.payments.map((p: any) => html`<tr><td class="small">${p.type}</td><td class="small">${p.outcome}</td><td class="small">${timeAgo(p.received_at)}</td></tr>`)}</tbody></table>
<p><strong>Domain:</strong> ${v.domain.domain ?? v.domain.mode} · ${v.domain.status}</p></section>
<section class="card"><h2>Events (with internal details)</h2><table><tbody>${d.events.map((e: any) => html`<tr><td class="small">${timeAgo(e.at)}</td><td class="small">${e.stage}</td><td class="small ${e.level === 'error' ? 'err-text' : ''}">${e.message}${e.internal ? html`<br><span class="muted">${e.internal}</span>` : ''}</td></tr>`)}</tbody></table></section>
<section class="card"><h2>Audit</h2><table><tbody>${d.audit.map((a: any) => html`<tr><td class="small">${timeAgo(a.at)}</td><td class="small">${a.actor}</td><td class="small">${a.action} ${a.detail_json !== '{}' ? a.detail_json : ''}</td></tr>`)}</tbody></table></section>
</div>`, demo);

  const reload = () => detail(id, demo);
  const cl = document.getElementById('cl') as HTMLFormElement;
  cl.addEventListener('change', async () => {
    const checklist: Record<string, boolean> = {};
    for (const [k] of CHECKLIST) checklist[k] = (cl.querySelector(`[name=${k}]`) as HTMLInputElement).checked;
    await api('POST', `/api/admin/projects/${id}/review`, { checklist });
  });
  document.getElementById('approve-preview')?.addEventListener('click', async (e) => {
    await busy(e.target as HTMLButtonElement, 'Approving…', () => api('POST', `/api/admin/projects/${id}/approve-preview`)).then(reload).catch(() => null);
  });
  document.getElementById('approve-launch')?.addEventListener('click', async (e) => {
    await busy(e.target as HTMLButtonElement, 'Approving…', () => api('POST', `/api/admin/projects/${id}/approve-launch`)).then(reload).catch(() => null);
  });
  document.getElementById('time')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = Number(((e.target as HTMLFormElement).elements.namedItem('minutes') as HTMLInputElement).value);
    await api('POST', `/api/admin/projects/${id}/time`, { minutes: m }).catch(() => null);
    toast('Logged.');
    void reload();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach((b) => b.addEventListener('click', async () => {
    await busy(b, 'Retrying…', () => api('POST', `/api/admin/jobs/${b.dataset.retry}/retry`)).then(() => { toast('Retry queued.'); void reload(); }).catch(() => null);
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-resend]').forEach((b) => b.addEventListener('click', async () => {
    await busy(b, 'Queuing…', () => api('POST', `/api/admin/notifications/${b.dataset.resend}/resend`)).then(reload).catch(() => null);
  }));
  document.querySelectorAll<HTMLFormElement>('form[data-propose]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const act = ((e as SubmitEvent).submitter as HTMLButtonElement)?.value ?? 'propose';
    const fd = new FormData(f);
    const cid = f.dataset.propose;
    try {
      if (act === 'propose') {
        const overrides: Record<string, string> = {};
        for (const k of ['heroTitle', 'heroSub']) if (String(fd.get(k) ?? '').trim()) overrides[k] = String(fd.get(k));
        const services = String(fd.get('services') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        await api('POST', `/api/admin/projects/${id}/change-requests/${cid}/propose`, { patch: { overrides, ...(services.length ? { facts: { services } } : {}) }, response: fd.get('response') });
      } else {
        await api('POST', `/api/admin/projects/${id}/change-requests/${cid}/status`, { status: act, response: fd.get('response') });
      }
      toast('Saved.');
      void reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }));
  document.querySelectorAll<HTMLFormElement>('form[data-ticket]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const close = ((e as SubmitEvent).submitter as HTMLButtonElement)?.value === '1';
    await api('POST', `/api/admin/projects/${id}/tickets/${f.dataset.ticket}/reply`, { body: new FormData(f).get('body'), close }).catch((err) => toast(err.message, 'error'));
    void reload();
  }));
}

async function settings(demo: boolean) {
  const s = await api('GET', '/api/admin/settings');
  shell(html`<p><a href="/admin">← Queue</a></p><h1>Settings</h1><form id="sf" class="card" style="max-width:560px">
<label class="check"><input type="checkbox" name="requirePreviewReview" ${s.requirePreviewReview ? 'checked' : ''}> Review previews before they’re sent to owners</label>
<label class="check"><input type="checkbox" name="requireLaunchReview" ${s.requireLaunchReview ? 'checked' : ''}> Review sites before launch</label>
<label class="check"><input type="checkbox" name="pausedIntake" ${s.pausedIntake ? 'checked' : ''}> Pause new previews (capacity or abuse)</label>
<div class="field"><label for="pt">Preview target (business days, shown to customers)</label><input class="input" id="pt" name="previewTargetBusinessDays" inputmode="numeric" value="${s.previewTargetBusinessDays}"></div>
<div class="field"><label for="ut">Update turnaround (business days)</label><input class="input" id="ut" name="updateTurnaroundBusinessDays" inputmode="numeric" value="${s.updateTurnaroundBusinessDays}"></div>
<button class="btn btn-primary">Save</button></form>`, demo);
  const f = document.getElementById('sf') as HTMLFormElement;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    await api('POST', '/api/admin/settings', {
      requirePreviewReview: fd.has('requirePreviewReview'), requireLaunchReview: fd.has('requireLaunchReview'), pausedIntake: fd.has('pausedIntake'),
      previewTargetBusinessDays: Number(fd.get('previewTargetBusinessDays')), updateTurnaroundBusinessDays: Number(fd.get('updateTurnaroundBusinessDays')),
    });
    toast('Saved.');
  });
}

async function metrics(demo: boolean) {
  const m = await api('GET', '/api/admin/metrics');
  const steps = ['intake_started', 'business_confirmed', 'preview_requested', 'preview_ready', 'preview_viewed', 'design_chosen', 'edit_requested', 'checkout_started', 'subscribed', 'launched'];
  shell(html`<p><a href="/admin">← Queue</a></p><h1>Conversion &amp; operations</h1>
<p class="muted small">Counts of projects reaching each step. No personal information is recorded in analytics. ${m.costNote}</p>
<div class="card"><table><tbody>${steps.map((s) => html`<tr><td>${s.replace(/_/g, ' ')}</td><td><strong>${m.funnel[s] ?? 0}</strong></td></tr>`)}</tbody></table></div>
<div class="kpis" style="margin-top:14px"><div class="kpi"><b>${m.avgLaunchHours == null ? '–' : m.avgLaunchHours.toFixed(1) + ' h'}</b><span class="small muted">Avg. time to launch</span></div>
<div class="kpi"><b>${m.adminMinutes}</b><span class="small muted">Admin minutes logged</span></div><div class="kpi"><b>${m.manualInterventions}</b><span class="small muted">Manual interventions</span></div>
<div class="kpi"><b>$${(m.providerCostCents / 100).toFixed(2)}</b><span class="small muted">Reported provider cost</span></div></div>`, demo);
}

void raw;
void esc;
void boot();
