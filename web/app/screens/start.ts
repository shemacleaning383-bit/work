import { api, html, navigate, store, busy, sheet, fieldError, toast, ApiError, type Safe } from '../lib.ts';
import { chrome, root, type AppConfig } from '../main.ts';
import type { Candidate, ProjectView } from '../../../shared/types.ts';
import { classifyIdentifier, formatPhone } from '../../../shared/validate.ts';

interface IntakeResult { projectId: string; status: string; message: string | null; candidates: Candidate[]; kind: string }

export function renderStart(cfg: AppConfig) {
  const draft = store.get<{ q: string; loc: string; pid: string }>('intake', { q: '', loc: '', pid: '' });
  const q = new URLSearchParams(location.search).get('q') ?? draft.q;
  let needsLocation = false;
  const paint = (status: Safe | '' = '') => {
    root().innerHTML = chrome(cfg, html`
<p class="step-label">Free preview · no card needed</p>
<h1>Find your business</h1>
<p class="lede">We’ll look it up and show you what we found before building anything.</p>
<form id="intake" novalidate>
  <div class="field">
    <label for="q">Paste your Google Maps link, website, or business name.</label>
    <input class="input" id="q" name="query" type="text" value="${q}" autocomplete="organization" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="2048" aria-describedby="q-help" required>
    <p class="help" id="q-help">For example: <span class="code">sundaycleaning.example</span> or <span class="code">Sunday Cleaning, Toronto</span>${cfg.mode === 'demo' ? ' (demo samples)' : ''}.</p>
  </div>
  <div class="field" id="loc-field" ${needsLocation ? '' : 'hidden'}>
    <label for="loc">City or area</label>
    <input class="input" id="loc" name="location" type="text" value="${draft.loc}" autocomplete="address-level2" enterkeyhint="search" maxlength="120">
    <p class="help">A few businesses share that name. The city helps us find the right one.</p>
  </div>
  <div id="status" aria-live="polite">${status}</div>
  <details class="section"><summary>Where do I find my Google Maps link?</summary><div class="body">
    <ol class="small muted" style="padding-left:20px;margin-top:0">
      <li>Open Google Maps and search your business name.</li>
      <li>Tap your business, then tap <strong>Share</strong>.</li>
      <li>Tap <strong>Copy link</strong> and paste it here.</li>
    </ol>
    <p class="small muted">No Google profile? Paste your website, or type your business name and city.</p>
  </div></details>
  <div class="actionbar">
    <button class="btn btn-primary btn-block" type="submit" id="go">Find my business</button>
    <button class="btn-link" type="button" id="manual">My business isn’t online yet</button>
  </div>
</form>`).s;
    const form = document.getElementById('intake') as HTMLFormElement;
    const input = form.querySelector('#q') as HTMLInputElement;
    const loc = form.querySelector('#loc') as HTMLInputElement;
    const save = () => store.set('intake', { q: input.value, loc: loc.value, pid: draft.pid });
    input.addEventListener('input', save);
    loc.addEventListener('input', save);
    if (needsLocation) loc.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!classifyIdentifier(value)) return fieldError(form, 'query', 'Paste a link or type your business name.');
      fieldError(form, undefined, '');
      const statusEl = document.getElementById('status')!;
      statusEl.innerHTML = html`<div class="card" style="margin-bottom:16px"><p style="margin:0 0 12px"><strong>Looking up “${value.length > 60 ? value.slice(0, 60) + '…' : value}”…</strong></p>
<div class="skel" style="height:18px;width:70%;margin-bottom:10px"></div><div class="skel" style="height:18px;width:45%"></div></div>`.s;
      try {
        const r = await busy(document.getElementById('go') as HTMLButtonElement, 'Looking…', () =>
          api<IntakeResult>('POST', '/api/intake', { query: value, location: needsLocation ? loc.value : '', projectId: draft.pid || undefined }));
        if (!r) return;
        draft.pid = r.projectId;
        store.set('intake', { q: value, loc: loc.value, pid: r.projectId });
        if (r.status === 'matches') return navigate(`/p/${r.projectId}/confirm`);
        if (r.status === 'needs_location') {
          needsLocation = true;
          document.getElementById('loc-field')!.hidden = false;
          statusEl.innerHTML = html`<p class="notice info">${r.message ?? 'Which city or area are you in?'}</p>`.s;
          loc.focus();
          return;
        }
        statusEl.innerHTML = html`<div class="notice ${r.status === 'none' ? 'info' : 'warn'}" style="margin-bottom:16px">
<p style="margin:0 0 6px"><strong>${r.status === 'none' ? 'We couldn’t find a match.' : 'We couldn’t look that up.'}</strong></p>
<p style="margin:0">${r.message ?? 'Check the spelling, try your website link, or add your city.'}</p></div>`.s;
      } catch (err) {
        if (err instanceof ApiError) statusEl.innerHTML = html`<p class="notice error">${err.message}</p>`.s;
      }
    });
    document.getElementById('manual')!.addEventListener('click', () => openManual(input.value));
  };
  paint();
}

function openManual(prefill: string) {
  const name = classifyIdentifier(prefill)?.kind === 'name' ? prefill.split(',')[0] : '';
  sheet('Start from your details', html`
<p class="muted" style="margin-top:0">No problem. Tell us your business name and where you work. You’ll add services and contact details next.</p>
<form id="manual-form" novalidate>
<div class="field"><label for="m-name">Business name</label><input class="input" id="m-name" name="name" value="${name}" autocomplete="organization" maxlength="120" required></div>
<div class="field"><label for="m-city">City or main area</label><input class="input" id="m-city" name="city" autocomplete="address-level2" maxlength="80" required></div>
<button class="btn btn-primary btn-block" type="submit">Continue</button>
</form>`, (el, close) => {
    const form = el.querySelector('form')!;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        const v = await busy(form.querySelector('button'), 'Starting…', () => api<ProjectView>('POST', '/api/projects/new/manual', { name: fd.get('name'), city: fd.get('city') }));
        if (!v) return;
        close();
        store.set('intake', { q: '', loc: '', pid: v.id });
        navigate(`/p/${v.id}/details`);
      } catch (err) {
        if (err instanceof ApiError) fieldError(form, err.field, err.message);
      }
    });
  });
}

export function candidateCard(c: Candidate, opts: { primary?: Safe } = {}): Safe {
  const found = new Date(c.foundAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const shot = c.screenshotUrl
    ? html`<figure class="shot"><img src="${c.screenshotUrl}" alt="Screenshot of ${c.name}’s ${c.sourceKind === 'website' ? 'website' : 'listing'}" width="400" height="300" loading="lazy" decoding="async">
<figcaption class="lbl"><span class="badge ${c.isSample ? 'sample' : ''}">${c.isSample ? 'Sample screenshot · demo data' : `Screenshot · ${c.sourceLabel}`}</span></figcaption></figure>`
    : html`<p class="noshot">${c.screenshotNote}</p>`;
  return html`<article class="card biz" aria-label="${c.name}">
<div>
<p class="biz-name">${c.name}</p>
${c.distinguishing ? html`<p class="muted small" style="margin:2px 0 0">${c.distinguishing}</p>` : ''}
</div>
<dl class="kv">
${c.city ? html`<dt>Area</dt><dd>${c.city}</dd>` : ''}
${c.address && c.address !== c.city ? html`<dt>Address</dt><dd>${c.address}</dd>` : ''}
${c.phone ? html`<dt>Phone</dt><dd>${formatPhone(c.phone)}</dd>` : ''}
${c.website ? html`<dt>Website</dt><dd>${c.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</dd>` : ''}
${c.category ? html`<dt>Type</dt><dd>${c.category}</dd>` : ''}
${c.rating ? html`<dt>Rating</dt><dd>${c.rating.value} (${c.rating.count}) <span class="badge ${c.isSample ? 'sample' : ''}">${c.rating.label}</span></dd>` : ''}
</dl>
${shot}
<p class="src">Found from <strong>${c.sourceLabel}</strong> · ${found}
${c.sourceUrl ? html`· <a href="${c.sourceUrl}" target="_blank" rel="noopener noreferrer">${c.isSample ? 'Sample source link' : 'View source'}</a>` : ''}
${c.isSample ? html`<span class="badge sample">Demo data</span>` : ''}</p>
${opts.primary ?? ''}
</article>`;
}

export function renderConfirm(cfg: AppConfig, v: ProjectView) {
  if (v.status !== 'draft') return navigate(`/p/${v.id}`, true);
  if (v.candidate) return navigate(`/p/${v.id}/details`, true);
  const list = v.candidates;
  if (!list.length) return navigate(`/start?q=${encodeURIComponent(v.intakeQuery)}`, true);
  const single = list.length === 1;
  root().innerHTML = chrome(cfg, html`
<h1>${single ? 'Is this your business?' : 'Which one is yours?'}</h1>
<p class="lede">${single ? 'Check the details below. We only build after you confirm.' : `We found ${list.length} businesses with similar names. Pick yours, or search again.`}</p>
<div class="cand-list">
${list.map((c) => candidateCard(c, single ? {} : { primary: html`<button class="btn btn-primary btn-block" data-pick="${c.id}">This is my business</button>` }))}
</div>
<p class="small muted" style="margin-top:14px">Confirming picks the business for your preview. It doesn’t prove ownership. Before anything goes live, we confirm your contact details and check that you control any domain the site uses.</p>
<div class="actionbar">
${single ? html`<button class="btn btn-primary btn-block" data-pick="${list[0].id}">Yes, that’s my business</button>` : ''}
<button class="btn btn-quiet btn-block" id="another">${single ? 'No, find another' : 'None of these. Search again'}</button>
${single ? html`<button class="btn-link" data-pick="${list[0].id}" data-fix="1">Some details are wrong</button>` : ''}
</div>`, { step: 1, of: 4, back: `/start?q=${encodeURIComponent(v.intakeQuery)}` }).s;
  root().querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
    const r = await busy(b, 'Confirming…', () => api<ProjectView>('POST', `/api/projects/${v.id}/confirm`, { candidateId: b.dataset.pick })).catch(() => null);
    if (r) navigate(`/p/${v.id}/details${b.dataset.fix ? '?fix=1' : ''}`);
  }));
  document.getElementById('another')!.addEventListener('click', async (e) => {
    await busy(e.currentTarget as HTMLButtonElement, 'One moment…', () => api('POST', `/api/projects/${v.id}/reject`)).catch(() => null);
    toast('Okay. Nothing from that listing will be used.');
    navigate(`/start?q=${encodeURIComponent(v.intakeQuery)}`);
  });
}
