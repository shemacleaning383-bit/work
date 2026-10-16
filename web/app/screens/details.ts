import { api, html, navigate, store, busy, fieldError, toast, ApiError, fact, type Safe } from '../lib.ts';
import { chrome, root, type AppConfig } from '../main.ts';
import { mountUploader } from './uploader.ts';
import type { ProjectView, FactView } from '../../../shared/types.ts';
import { SERVICE_CATALOG } from '../../../shared/types.ts';
import { GTA_AREAS } from '../../../shared/areas.ts';
import { formatPhone } from '../../../shared/validate.ts';

export const ACCENTS = ['#1652f0', '#0f7a55', '#0e7490', '#7c3aed', '#be185d', '#c2410c', '#334155'];

type Draft = Record<string, any>;

function sourceTag(f: FactView | undefined, draftChanged: boolean): Safe {
  if (draftChanged || f?.source === 'owner') return html`<span class="badge ok">From you</span>`;
  if (!f || f.source === 'none') return html``;
  const sample = /demo|sample/i.test(f.sourceLabel ?? '');
  return html`<span class="badge ${sample ? 'sample' : 'blue'}">From ${f.sourceLabel}</span>${f.needsConfirmation ? html` <span class="badge">Please check</span>` : ''}`;
}

export function renderDetails(cfg: AppConfig, v: ProjectView) {
  if (!['draft', 'needs_info'].includes(v.status)) return navigate(`/p/${v.id}`, true);
  if (!v.candidate) return navigate(`/p/${v.id}/confirm`, true);
  const params = new URLSearchParams(location.search);
  const step = Math.min(3, Math.max(1, Number(params.get('step') ?? 1)));
  const key = `details:${v.id}`;
  const draft: Draft = store.get<Draft>(key, {});
  const get = (k: string) => (k in draft ? draft[k] : fact(v, k));
  const fv = (k: string) => v.facts.find((f) => f.key === k);
  const save = () => store.set(key, draft);
  const go = (s: number) => navigate(`/p/${v.id}/details?step=${s}${params.get('fix') ? '&fix=1' : ''}`);

  const header = html`
<p class="step-label">${v.candidate.name}</p>
<h1>${step === 1 ? 'Anything you’d like to add or correct?' : step === 2 ? 'How customers reach you' : 'Optional extras'}</h1>
<p class="lede">${step === 1 ? 'We filled this in from what we found. Change anything that isn’t right.' : step === 2 ? 'These details appear on your website for customers to see.' : 'All optional. Add what you have now; you can change it later.'}</p>
${v.status === 'needs_info' && v.needsInfo.length ? html`<p class="notice warn">To finish your preview we need: <strong>${v.needsInfo.join(', ')}</strong>.</p>` : ''}
${params.get('fix') && step === 1 ? html`<p class="notice info">Correct anything that’s wrong below. Your changes always override what we found online.</p>` : ''}
<nav aria-label="Steps" class="step-chips">
${[1, 2, 3].map((n) => html`<button class="chip" type="button" data-goto="${n}" aria-pressed="${n === step}" aria-label="Go to part ${n} of 3">${n}. ${['Business', 'Contact', 'Extras'][n - 1]}</button>`)}
</nav>`;

  let body: Safe;
  if (step === 1) {
    const services: string[] = get('services') ?? [];
    const catalog = [...SERVICE_CATALOG, ...services.filter((s) => !(SERVICE_CATALOG as readonly string[]).includes(s))];
    const areas: string[] = get('areas') ?? [];
    body = html`
<div class="field"><label for="displayName">Business name shown on your site</label>
<input class="input" id="displayName" name="displayName" value="${get('displayName') ?? ''}" autocomplete="organization" maxlength="120">
<div class="src">${sourceTag(fv('displayName'), 'displayName' in draft)}</div></div>

<div class="field"><span class="label" id="svc-l">Services you offer</span>
<p class="help">Tap to select. Only pick what you actually do.</p>
<div class="chips" role="group" aria-labelledby="svc-l">${catalog.map((s) => html`<button type="button" class="chip" data-svc="${s}" aria-pressed="${services.includes(s)}">${s}</button>`)}</div>
<div class="inline-add"><input class="input" id="svc-new" placeholder="Add another service" maxlength="60" aria-label="Add another service" enterkeyhint="done"><button class="btn btn-quiet" type="button" id="svc-add">Add</button></div>
<input type="hidden" name="services"><div class="src">${sourceTag(fv('services'), 'services' in draft)}</div></div>

<div class="field"><span class="label" id="area-l">Areas you serve</span>
<div class="chips" role="group" aria-labelledby="area-l" id="area-chips">${areas.map((a) => html`<button type="button" class="chip" data-area="${a}" aria-pressed="true" aria-label="Remove ${a}">${a} <span class="x" aria-hidden="true">×</span></button>`)}</div>
<div class="inline-add"><input class="input" id="area-new" list="gta" placeholder="Add a city or neighbourhood" maxlength="60" aria-label="Add a city or neighbourhood" autocomplete="off" enterkeyhint="done"><button class="btn btn-quiet" type="button" id="area-add">Add</button></div>
<datalist id="gta">${GTA_AREAS.map((a) => html`<option value="${a}">`)}</datalist>
<input type="hidden" name="areas"><div class="src">${sourceTag(fv('areas'), 'areas' in draft)}</div></div>`;
  } else if (step === 2) {
    const phoneF = fv('publicPhone');
    const conflict = phoneF?.conflict && !('publicPhone' in draft) ? phoneF.conflict : null;
    body = html`
<p class="notice info" style="margin-bottom:16px">This is your <strong>public</strong> business contact. Where we send <em>your</em> preview updates is asked separately and never shown on the site.</p>
${conflict ? html`<fieldset class="field" style="border:0;padding:0;margin:0 0 16px"><legend class="label" style="font-weight:700;margin-bottom:6px">We found different phone numbers. Which is right?</legend>
<div class="radio-list">${[phoneF!.value, ...conflict.values.map((c) => c.value)].filter((x, i, a) => x && a.indexOf(x) === i).map((val) => html`<label class="radio"><input type="radio" name="phonePick" value="${val}" ${val === get('publicPhone') ? 'checked' : ''}><span><strong>${formatPhone(String(val))}</strong><br><span class="small muted">${conflict.values.find((c) => c.value === val)?.sourceLabel ?? phoneF!.sourceLabel}</span></span></label>`)}</div></fieldset>` : ''}
<div class="field"><label for="publicPhone">Business phone</label>
<input class="input" id="publicPhone" name="publicPhone" type="tel" inputmode="tel" autocomplete="tel" value="${formatPhone(get('publicPhone') ?? '') || (get('publicPhone') ?? '')}" maxlength="40">
<div class="src">${sourceTag(phoneF, 'publicPhone' in draft)}</div></div>
<div class="field"><label for="publicEmail">Business email <span class="muted">(optional)</span></label>
<input class="input" id="publicEmail" name="publicEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="${get('publicEmail') ?? ''}" maxlength="254">
<div class="src">${sourceTag(fv('publicEmail'), 'publicEmail' in draft)}</div></div>
<fieldset class="field" style="border:0;padding:0"><legend class="label" style="font-weight:700;margin-bottom:6px">Main button on your site</legend>
<div class="radio-list">
<label class="radio"><input type="radio" name="mainAction" value="quote" ${get('mainAction') !== 'contact' ? 'checked' : ''}><span><strong>Request a quote</strong><br><span class="small muted">Customers describe their home and what they need.</span></span></label>
<label class="radio"><input type="radio" name="mainAction" value="contact" ${get('mainAction') === 'contact' ? 'checked' : ''}><span><strong>Contact us</strong><br><span class="small muted">A simple message form.</span></span></label>
</div></fieldset>
<fieldset class="field" style="border:0;padding:0"><legend class="label" style="font-weight:700;margin-bottom:6px">How do you prefer customers reach you?</legend>
<div class="chips">${[['phone', 'Phone call'], ['email', 'Email'], ['form', 'Quote form']].map(([val, lbl]) => html`<label class="chip"><input type="radio" name="preferredContact" value="${val}" ${(get('preferredContact') ?? 'phone') === val ? 'checked' : ''} style="accent-color:var(--blue)"> ${lbl}</label>`)}</div></fieldset>`;
  } else {
    const accent = get('accentColor');
    body = html`
<details class="section" open><summary>Logo and photos</summary><div class="body">
<p class="help small muted" style="margin-top:0">Real photos of your work or team help most. We never invent team photos; without photos we use simple illustrations.</p>
<p class="label" style="font-weight:700;margin:0">Logo</p><div id="up-logo"></div>
<p class="label" style="font-weight:700;margin:14px 0 0">Photos</p><div id="up-photos"></div>
</div></details>
<details class="section"><summary>About your business</summary><div class="body">
<div class="field"><label for="description">Short description</label><textarea class="input" id="description" name="description" maxlength="600" rows="3" placeholder="e.g. We’re a small team cleaning homes and condos in East Toronto.">${get('description') ?? ''}</textarea>
<div class="src">${sourceTag(fv('description'), 'description' in draft)}</div></div>
<div class="field"><label for="differentiator">One sentence about what makes you different</label><textarea class="input" id="differentiator" name="differentiator" maxlength="280" rows="2" placeholder="In your own words">${get('differentiator') ?? ''}</textarea>
<p class="help">Only include claims you can stand behind (for example, insurance) because they will appear on your site.</p></div>
</div></details>
<details class="section"><summary>Style and colour</summary><div class="body">
<fieldset class="field" style="border:0;padding:0"><legend class="label" style="font-weight:700;margin-bottom:6px">Preferred style</legend>
<div class="chips">${[['none', 'No preference'], ['bright', 'Bright & friendly'], ['calm', 'Calm & classic']].map(([val, lbl]) => html`<label class="chip"><input type="radio" name="stylePreference" value="${val}" ${(get('stylePreference') ?? 'none') === val ? 'checked' : ''}> ${lbl}</label>`)}</div>
<p class="help">You’ll still see both designs.</p></fieldset>
<div class="field"><span class="label">Accent colour</span><div class="swatches" role="group" aria-label="Accent colour">
<button type="button" class="swatch" data-color="" aria-pressed="${!accent}" aria-label="No preference" style="background:repeating-linear-gradient(45deg,#fff,#fff 6px,#eee 6px,#eee 12px)"></button>
${ACCENTS.map((c) => html`<button type="button" class="swatch" data-color="${c}" aria-pressed="${accent === c}" aria-label="Colour ${c}" style="background:${c}"></button>`)}</div></div>
</div></details>
<details class="section"><summary>Booking link and other links</summary><div class="body">
<div class="field"><label for="bookingUrl">Existing online booking link</label><input class="input" id="bookingUrl" name="bookingUrl" type="url" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" value="${get('bookingUrl') ?? ''}" placeholder="https://"></div>
<div class="field"><label for="otherLinks">Other pages about your business (one per line)</label><textarea class="input" id="otherLinks" name="otherLinks" rows="2" autocapitalize="off" spellcheck="false" placeholder="Instagram, Facebook, Yelp…">${(get('otherLinks') ?? []).join('\n')}</textarea></div>
</div></details>
<details class="section"><summary>Hours and pricing</summary><div class="body">
<div class="field"><label for="hours">Hours</label><input class="input" id="hours" name="hours" value="${get('hours') ?? ''}" maxlength="200" placeholder="e.g. Mon–Sat, 8 a.m.–6 p.m.">
<div class="src">${sourceTag(fv('hours'), 'hours' in draft)}</div>
<label class="check"><input type="checkbox" name="showHours" ${get('showHours') ? 'checked' : ''}> Show hours on my website</label></div>
<div class="field"><label for="pricing">Pricing</label><textarea class="input" id="pricing" name="pricing" rows="2" maxlength="300" placeholder="Only if you want prices on your site">${get('pricing') ?? ''}</textarea>
<label class="check"><input type="checkbox" name="showPricing" ${get('showPricing') ? 'checked' : ''}> Show pricing on my website</label></div>
</div></details>`;
  }

  root().innerHTML = chrome(cfg, html`${header}
<form id="details" novalidate>${body}
<div class="actionbar">
${step < 3 ? html`<div class="row">${step > 1 ? html`<button class="btn btn-quiet" type="button" data-goto="${step - 1}">Back</button>` : html`<span></span>`}<button class="btn btn-primary" type="submit">Next</button></div>`
    : html`<button class="btn btn-primary btn-block" type="submit" id="build">Looks good, build my preview</button><p class="hint">Free and private. Takes a few minutes; we’ll keep you posted.</p>`}
</div></form>`, { step: 2, of: 4, back: step > 1 ? `/p/${v.id}/details?step=${step - 1}` : `/p/${v.id}/confirm` }).s;

  const form = document.getElementById('details') as HTMLFormElement;
  // Inputs → local draft (survives refresh, back, and interrupted sessions).
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.name || ['services', 'areas', 'phonePick'].includes(t.name)) return;
    draft[t.name] = t.type === 'checkbox' ? t.checked : t.name === 'otherLinks' ? t.value.split('\n').map((s) => s.trim()).filter(Boolean) : t.value;
    save();
  });
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'phonePick') {
      draft.publicPhone = t.value;
      (form.querySelector('#publicPhone') as HTMLInputElement).value = formatPhone(t.value);
      save();
    } else if (t.type === 'radio' || t.type === 'checkbox') {
      draft[t.name] = t.type === 'checkbox' ? t.checked : t.value;
      save();
    }
  });
  root().querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) => b.addEventListener('click', () => void submit(Number(b.dataset.goto))));
  root().querySelectorAll<HTMLButtonElement>('[data-svc]').forEach((b) => b.addEventListener('click', () => {
    const cur: string[] = [...(get('services') ?? [])];
    const s = b.dataset.svc!;
    draft.services = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    b.setAttribute('aria-pressed', String(draft.services.includes(s)));
    save();
  }));
  const addSvc = () => {
    const inp = document.getElementById('svc-new') as HTMLInputElement;
    const val = inp.value.trim();
    if (!val) return;
    draft.services = [...new Set([...(get('services') ?? []), val])];
    save();
    renderDetails(cfg, v);
  };
  document.getElementById('svc-add')?.addEventListener('click', addSvc);
  document.getElementById('svc-new')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSvc(); } });
  const addArea = () => {
    const inp = document.getElementById('area-new') as HTMLInputElement;
    const val = inp.value.trim();
    if (!val) return;
    draft.areas = [...new Set([...(get('areas') ?? []), val])];
    save();
    renderDetails(cfg, v);
    (document.getElementById('area-new') as HTMLInputElement | null)?.focus();
  };
  document.getElementById('area-add')?.addEventListener('click', addArea);
  document.getElementById('area-new')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } });
  root().querySelectorAll<HTMLButtonElement>('[data-area]').forEach((b) => b.addEventListener('click', () => {
    draft.areas = (get('areas') ?? []).filter((a: string) => a !== b.dataset.area);
    save();
    renderDetails(cfg, v);
  }));
  root().querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => b.addEventListener('click', () => {
    draft.accentColor = b.dataset.color;
    root().querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    save();
  }));
  if (step === 3) {
    mountUploader(document.getElementById('up-logo')!, v.id, 'logo', v.assets, { max: 1, label: 'Upload your logo' });
    mountUploader(document.getElementById('up-photos')!, v.id, 'photo', v.assets, { max: cfg.offer.limits.photoUploadsPerProject, label: 'Upload photos of your work' });
  }

  const STEP_KEYS: Record<number, string[]> = {
    1: ['displayName', 'services', 'areas'],
    2: ['publicPhone', 'publicEmail', 'mainAction', 'preferredContact'],
    3: ['description', 'differentiator', 'stylePreference', 'accentColor', 'bookingUrl', 'otherLinks', 'hours', 'showHours', 'pricing', 'showPricing'],
  };

  async function submit(target: number | 'build') {
    // Send this step's values (confirmed by the owner) to the server.
    const facts: Record<string, unknown> = {};
    for (const k of STEP_KEYS[step]) {
      const val = get(k);
      if (val !== null && val !== undefined && !(k === 'accentColor' && val === '')) facts[k] = val;
      else if (k in draft) facts[k] = val;
    }
    if (step === 2 && !facts.mainAction) facts.mainAction = 'quote';
    try {
      const btn = target === 'build' ? (document.getElementById('build') as HTMLButtonElement) : (form.querySelector('[type=submit]') as HTMLButtonElement);
      await busy(target === 'build' ? btn : null, 'Saving…', () => api('PUT', `/api/projects/${v.id}/details`, { facts }), false);
      if (target === 'build') {
        await busy(btn, 'Starting your build…', () => api('POST', `/api/projects/${v.id}/build`), false);
        store.del(key);
        store.del('intake');
        navigate(`/p/${v.id}/build`);
      } else {
        for (const k of STEP_KEYS[step]) delete draft[k];
        save();
        const fresh = await api<ProjectView>('GET', `/api/projects/${v.id}`);
        Object.assign(v, fresh);
        go(target);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'missing_info') {
          toast(e.message, 'error');
          return;
        }
        if (!fieldError(form, e.field, e.message)) toast(e.message, 'error');
      }
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit(step < 3 ? step + 1 : 'build');
  });
}
