import { api, html, navigate, store, busy, fieldError, toast, ApiError, confirmSheet, fact, uid, timeAgo, type Safe } from '../lib.ts';
import { chrome, root, type AppConfig } from '../main.ts';
import { mountUploader } from './uploader.ts';
import { frame, bindFrames } from './designs.ts';
import { ACCENTS } from './details.ts';
import { SERVICE_CATALOG } from '../../../shared/types.ts';
import { GTA_AREAS } from '../../../shared/areas.ts';
import type { ProjectView } from '../../../shared/types.ts';
import { formatPhone } from '../../../shared/validate.ts';

const EDITABLE = ['directions_ready', 'site_ready', 'paid', 'launching', 'live'];
const SECTION_LABELS: Record<string, string> = { photos: 'Photos', areas: 'Service areas', hours: 'Hours', pricing: 'Pricing', about: 'About page' };
const CR_STATUS: Record<string, [string, string]> = {
  received: ['Received', ''], in_progress: ['In progress', 'blue'], proposed: ['Ready for your review', 'blue'], done: ['Done', 'ok'], declined: ['Not possible', 'err'],
};

export function renderEdit(cfg: AppConfig, initial: ProjectView) {
  let v = initial;
  if (!EDITABLE.includes(v.status)) return navigate(`/p/${v.id}`, true);
  const reqKey = `req:${v.id}`;
  const reqDraft = store.get<{ message: string; key: string; attachment: string | null }>(reqKey, { message: '', key: uid(), attachment: null });
  const variant = v.chosenVariant ?? 'a';

  const paint = () => {
    const site = v.currentSite;
    const services: string[] = fact(v, 'services') ?? [];
    const areas: string[] = fact(v, 'areas') ?? [];
    const accent = fact(v, 'accentColor');
    const proposals = v.changeRequests.filter((c) => c.status === 'proposed');
    const current = v.siteVersions.find((s) => s.status === 'current');
    const conflicts = v.facts.filter((f) => f.conflict && f.conflict.values.length);
    root().innerHTML = chrome(cfg, html`
<h1>Edit your website</h1>
<p class="lede">Change these yourself anytime. Every save is a new version you can undo.</p>
${conflicts.length ? html`<p class="notice warn">Please check: some public details disagree with yours (${conflicts.map((c) => c.key === 'publicPhone' ? 'phone' : c.key).join(', ')}). Your version is the one on the site.</p>` : ''}
${proposals.map((p) => html`<div class="card" style="border-color:var(--blue)"><h2>A change is ready for your review</h2><p class="muted">You asked: “${p.message}”</p>${p.response ? html`<p>${p.response}</p>` : ''}
${frame(`/preview/${v.id}/v_${p.proposedVersionId}/`, 'Proposed change preview')}
<div class="stack" style="margin-top:12px"><button class="btn btn-primary btn-block" data-approve="${p.id}">Approve this change</button><button class="btn btn-quiet btn-block" data-reject="${p.id}">Send it back</button></div></div>`)}

<form id="quick" novalidate class="stack">
<details class="section" open><summary>Text</summary><div class="body">
<div class="field"><label for="displayName">Business name</label><input class="input" id="displayName" name="displayName" value="${fact(v, 'displayName') ?? ''}" maxlength="120" autocomplete="organization"></div>
<div class="field"><label for="heroTitle">Headline</label><input class="input" id="heroTitle" name="heroTitle" value="${site?.overrides.heroTitle ?? ''}" placeholder="${site?.copy.heroTitle ?? ''}" maxlength="200"><p class="help">Leave empty to keep: “${site?.copy.heroTitle ?? ''}”</p></div>
<div class="field"><label for="heroSub">Intro sentence</label><textarea class="input" id="heroSub" name="heroSub" rows="2" maxlength="200" placeholder="${site?.copy.heroSub ?? ''}">${site?.overrides.heroSub ?? ''}</textarea></div>
<div class="field"><label for="description">About your business</label><textarea class="input" id="description" name="description" rows="3" maxlength="600">${fact(v, 'description') ?? ''}</textarea></div>
</div></details>
<details class="section"><summary>Contact details</summary><div class="body">
<div class="field"><label for="publicPhone">Business phone</label><input class="input" id="publicPhone" name="publicPhone" type="tel" inputmode="tel" autocomplete="tel" value="${formatPhone(fact(v, 'publicPhone'))}" maxlength="40"></div>
<div class="field"><label for="publicEmail">Business email</label><input class="input" id="publicEmail" name="publicEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" value="${fact(v, 'publicEmail') ?? ''}" maxlength="254"></div>
</div></details>
<details class="section"><summary>Services and areas</summary><div class="body">
<div class="chips" role="group" aria-label="Services">${[...SERVICE_CATALOG, ...services.filter((s) => !(SERVICE_CATALOG as readonly string[]).includes(s))].map((s) => html`<button type="button" class="chip" data-svc="${s}" aria-pressed="${services.includes(s)}">${s}</button>`)}</div>
<div class="inline-add"><input class="input" id="svc-new" placeholder="Add another service" maxlength="60" aria-label="Add another service"><button class="btn btn-quiet" type="button" id="svc-add">Add</button></div>
<p class="label" style="font-weight:700;margin:16px 0 6px">Areas</p>
<div class="chips">${areas.map((a) => html`<button type="button" class="chip" data-area="${a}" aria-pressed="true" aria-label="Remove ${a}">${a} <span class="x" aria-hidden="true">×</span></button>`)}</div>
<div class="inline-add"><input class="input" id="area-new" list="gta2" placeholder="Add an area" maxlength="60" aria-label="Add an area"><button class="btn btn-quiet" type="button" id="area-add">Add</button></div>
<datalist id="gta2">${GTA_AREAS.map((a) => html`<option value="${a}">`)}</datalist>
</div></details>
<details class="section"><summary>Colour and sections</summary><div class="body">
<div class="swatches" role="group" aria-label="Accent colour">${ACCENTS.map((c) => html`<button type="button" class="swatch" data-color="${c}" aria-pressed="${accent === c}" aria-label="Colour ${c}" style="background:${c}"></button>`)}</div>
<p class="label" style="font-weight:700;margin:16px 0 4px">Show these sections</p>
${Object.entries(SECTION_LABELS).map(([k, l]) => html`<label class="check"><input type="checkbox" name="sec-${k}" ${site?.sections[k] !== false ? 'checked' : ''}> ${l}</label>`)}
<div class="field" style="margin-top:10px"><label for="hours">Hours</label><input class="input" id="hours" name="hours" value="${fact(v, 'hours') ?? ''}" maxlength="200"><label class="check"><input type="checkbox" name="showHours" ${fact(v, 'showHours') ? 'checked' : ''}> Show hours</label></div>
<div class="field"><label for="pricing">Pricing</label><textarea class="input" id="pricing" name="pricing" rows="2" maxlength="300">${fact(v, 'pricing') ?? ''}</textarea><label class="check"><input type="checkbox" name="showPricing" ${fact(v, 'showPricing') ? 'checked' : ''}> Show pricing</label></div>
</div></details>
<details class="section"><summary>Photos and logo</summary><div class="body"><p class="small muted" style="margin-top:0">New photos are added to your site right away as a new version.</p>
<p style="font-weight:700;margin:0">Logo</p><div id="up-logo"></div><p style="font-weight:700;margin:12px 0 0">Photos</p><div id="up-photos"></div></div></details>
<button class="btn btn-primary btn-block" type="submit" id="save">Save changes</button>
${current ? html`<p class="small muted" style="text-align:center;margin:6px 0 0">Current: version ${current.number}, ${current.reason.toLowerCase()} (${timeAgo(current.createdAt)})</p>` : ''}
</form>

<section class="card" id="request" style="margin-top:20px"><h2>Tell us what you’d like changed</h2>
<p class="muted small" style="margin-top:0">For anything you can’t change above. We aim to reply within ${cfg.settings.updateTurnaroundBusinessDays} business days, and you’ll preview it before it goes on your site.</p>
<form id="req-form" novalidate>
<div class="field"><label for="req-msg" class="sr-only">Your request</label><textarea class="input" id="req-msg" name="message" rows="4" maxlength="2000" placeholder="e.g. Add a page about move-out cleaning for landlords.">${reqDraft.message}</textarea></div>
<p style="font-weight:700;margin:0">Screenshot or photo (optional)</p><div id="up-attach"></div>
<details style="margin:8px 0"><summary class="small" style="cursor:pointer;min-height:44px;display:flex;align-items:center">What’s included?</summary>
<p class="small muted">Included: ${cfg.offer.routineUpdates.join('; ').toLowerCase()}. Not included: ${cfg.offer.outOfScope.join('; ').toLowerCase()}.</p></details>
<button class="btn btn-dark btn-block" type="submit">Send request</button></form></section>

${v.changeRequests.length ? html`<section style="margin-top:20px"><h2>Your requests</h2><ul class="list">${v.changeRequests.map((c) => html`<li><div class="row-item" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><span>${c.message.length > 80 ? c.message.slice(0, 80) + '…' : c.message}</span><span class="badge ${CR_STATUS[c.status][1]}">${CR_STATUS[c.status][0]}</span></div>
${c.response ? html`<p class="small muted" style="margin:4px 0 0">Blue Park: ${c.response}</p>` : ''}<p class="small muted" style="margin:2px 0 0">${timeAgo(c.createdAt)}</p></div></li>`)}</ul></section>` : ''}

<section style="margin-top:20px"><h2>Version history</h2><ul class="list">${v.siteVersions.filter((s) => s.status !== 'proposed' && s.status !== 'rejected').slice(0, 10).map((s) => html`<li><div class="row-item"><span><strong>v${s.number}</strong> ${s.reason}<br><span class="small muted">${timeAgo(s.createdAt)} · ${s.author === 'owner' ? 'you' : s.author === 'team' ? 'Blue Park team' : 'Blue Park'}</span></span>
${s.status === 'current' ? html`<span class="badge ok">Current</span>` : html`<button class="btn btn-quiet" style="min-height:44px;padding:8px 14px" data-restore="${s.id}" data-n="${s.number}">Restore</button>`}</div></li>`)}</ul></section>
<div class="actionbar"><a class="btn btn-quiet btn-block" href="${v.status === 'live' ? `/app?p=${v.id}` : `/p/${v.id}/${v.status === 'directions_ready' ? 'designs' : 'site'}`}" data-link>Done</a></div>
`, { back: v.status === 'live' ? `/app?p=${v.id}` : `/p/${v.id}`, backLabel: 'Back' }).s;
    bind();
    if (location.hash === '#request') document.getElementById('request')?.scrollIntoView();
  };

  const pending: Record<string, any> = {};
  const bind = () => {
    const form = document.getElementById('quick') as HTMLFormElement;
    root().querySelectorAll<HTMLButtonElement>('[data-svc]').forEach((b) => b.addEventListener('click', () => {
      const cur: string[] = pending.services ?? [...(fact(v, 'services') ?? [])];
      const s = b.dataset.svc!;
      pending.services = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
      b.setAttribute('aria-pressed', String(pending.services.includes(s)));
    }));
    document.getElementById('svc-add')!.addEventListener('click', () => {
      const i = document.getElementById('svc-new') as HTMLInputElement;
      if (!i.value.trim()) return;
      pending.services = [...new Set([...(pending.services ?? fact(v, 'services') ?? []), i.value.trim()])];
      void save(document.getElementById('save') as HTMLButtonElement);
    });
    root().querySelectorAll<HTMLButtonElement>('[data-area]').forEach((b) => b.addEventListener('click', () => {
      pending.areas = (pending.areas ?? fact(v, 'areas') ?? []).filter((a: string) => a !== b.dataset.area);
      b.remove();
    }));
    document.getElementById('area-add')!.addEventListener('click', () => {
      const i = document.getElementById('area-new') as HTMLInputElement;
      if (!i.value.trim()) return;
      pending.areas = [...new Set([...(pending.areas ?? fact(v, 'areas') ?? []), i.value.trim()])];
      void save(document.getElementById('save') as HTMLButtonElement);
    });
    root().querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => b.addEventListener('click', () => {
      pending.accentColor = b.dataset.color;
      root().querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    form.addEventListener('submit', (e) => { e.preventDefault(); void save(document.getElementById('save') as HTMLButtonElement); });
    mountUploader(document.getElementById('up-logo')!, v.id, 'logo', v.assets, { max: 1, label: 'Upload logo', onChange: (nv) => nv && autoSaveAssets(nv) });
    mountUploader(document.getElementById('up-photos')!, v.id, 'photo', v.assets, { max: cfg.offer.limits.photoUploadsPerProject, label: 'Upload photos', onChange: (nv) => nv && autoSaveAssets(nv) });
    mountUploader(document.getElementById('up-attach')!, v.id, 'attachment', [], { max: 1, label: 'Attach a screenshot or photo', onChange: (_nv, id) => { reqDraft.attachment = id ?? null; store.set(reqKey, reqDraft); } });
    const reqForm = document.getElementById('req-form') as HTMLFormElement;
    reqForm.querySelector('textarea')!.addEventListener('input', (e) => { reqDraft.message = (e.target as HTMLTextAreaElement).value; store.set(reqKey, reqDraft); });
    reqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await busy(reqForm.querySelector('[type=submit]'), 'Sending…', () => api('POST', `/api/projects/${v.id}/change-requests`, { message: reqDraft.message, attachmentAssetId: reqDraft.attachment, idempotencyKey: reqDraft.key }), false);
        if (!r) return;
        store.del(reqKey);
        Object.assign(reqDraft, { message: '', key: uid(), attachment: null });
        v = r.view;
        toast(r.duplicate ? 'We already have this request.' : 'Request sent. We’ll update you here.');
        paint();
      } catch (err) {
        if (err instanceof ApiError && !fieldError(reqForm, err.field, err.message)) toast(err.message, 'error');
      }
    });
    root().querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmSheet(`Restore version ${b.dataset.n}?`, html`<p>Your site goes back to version ${b.dataset.n}. Your current version stays in the history, so you can switch back.</p>`, 'Restore');
      if (!ok) return;
      const nv = await busy(b, 'Restoring…', () => api<ProjectView>('POST', `/api/projects/${v.id}/versions/${b.dataset.restore}/restore`)).catch(() => null);
      if (nv) { v = nv; toast(`Restored version ${b.dataset.n}.`); paint(); }
    }));
    root().querySelectorAll<HTMLButtonElement>('[data-approve],[data-reject]').forEach((b) => b.addEventListener('click', async () => {
      const approve = !!b.dataset.approve;
      const nv = await busy(b, approve ? 'Applying…' : 'Sending back…', () => api<ProjectView>('POST', `/api/projects/${v.id}/change-requests/${b.dataset.approve ?? b.dataset.reject}/decision`, { approve })).catch(() => null);
      if (nv) { v = nv; toast(approve ? 'Change applied.' : 'Sent back to the team.'); paint(); }
    }));
    bindFrames(root());
  };

  const autoSaveAssets = async (nv: ProjectView) => {
    try {
      v = await api<ProjectView>('POST', `/api/projects/${v.id}/edit`, { facts: { photoAssetIds: nv.assets.filter((a) => a.kind === 'photo').map((a) => a.id), logoAssetId: nv.assets.find((a) => a.kind === 'logo')?.id ?? null } });
      toast('Photos updated on your site.');
    } catch (e) {
      if (e instanceof ApiError) toast(e.message, 'error');
    }
  };

  const save = async (btn: HTMLButtonElement) => {
    const form = document.getElementById('quick') as HTMLFormElement;
    const fd = new FormData(form);
    const facts: Record<string, unknown> = { ...pending };
    const val = (k: string) => String(fd.get(k) ?? '');
    const cmp = (k: string, cur: unknown) => { if (val(k) !== String(cur ?? '')) facts[k] = val(k); };
    cmp('displayName', fact(v, 'displayName'));
    cmp('description', fact(v, 'description'));
    cmp('publicEmail', fact(v, 'publicEmail'));
    cmp('hours', fact(v, 'hours'));
    cmp('pricing', fact(v, 'pricing'));
    if (val('publicPhone') !== formatPhone(fact(v, 'publicPhone'))) facts.publicPhone = val('publicPhone');
    for (const k of ['showHours', 'showPricing']) if (fd.has(k) !== !!fact(v, k)) facts[k] = fd.has(k);
    const overrides: Record<string, string> = {};
    for (const k of ['heroTitle', 'heroSub']) if (val(k) !== (v.currentSite?.overrides[k] ?? '')) overrides[k] = val(k);
    const sections: Record<string, boolean> = {};
    for (const k of Object.keys(SECTION_LABELS)) if (fd.has(`sec-${k}`) !== (v.currentSite?.sections[k] !== false)) sections[k] = fd.has(`sec-${k}`);
    if (!Object.keys(facts).length && !Object.keys(overrides).length && !Object.keys(sections).length) return toast('No changes to save.');
    try {
      const nv = await busy(btn, 'Saving…', () => api<ProjectView>('POST', `/api/projects/${v.id}/edit`, { facts, overrides, sections }), false);
      if (!nv) return;
      for (const k of Object.keys(pending)) delete pending[k];
      v = nv;
      const cur = v.siteVersions.find((s) => s.status === 'current');
      toast(`Saved as version ${cur?.number}.${v.status === 'live' ? ' Updating your live site.' : ''}`);
      paint();
    } catch (e) {
      if (e instanceof ApiError && !fieldError(form, e.field, e.message)) toast(e.message, 'error');
    }
  };
  paint();
}

export type { Safe };
