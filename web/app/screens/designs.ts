import { api, html, navigate, store, busy, confirmSheet, toast, type Safe } from '../lib.ts';
import { chrome, root, onLeave, type AppConfig } from '../main.ts';
import type { ProjectView, DesignVariantView } from '../../../shared/types.ts';

export function frame(src: string, title: string, opts: { lazy?: boolean } = {}): Safe {
  return html`<div class="frame-wrap"><div class="frame-bar"><span class="small"><strong>${title}</strong></span><button class="icon-btn" type="button" data-full="${src}" data-title="${title}">Full screen</button></div>
<iframe src="${src}" title="${title}" ${opts.lazy ? 'loading="lazy"' : ''} sandbox="allow-scripts allow-forms allow-popups"></iframe></div>`;
}

export function openFullscreen(src: string, title: string) {
  const prev = document.activeElement as HTMLElement | null;
  const el = document.createElement('div');
  el.className = 'fullscreen';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', title);
  el.innerHTML = html`<div class="bar"><button class="btn btn-dark" type="button" data-close>← Back</button><span class="small" style="flex:1;text-align:right"><strong>${title}</strong></span></div>
<iframe src="${src}" title="${title}" sandbox="allow-scripts allow-forms allow-popups"></iframe>`.s;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  const close = () => {
    el.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    prev?.focus();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  (el.querySelector('[data-close]') as HTMLButtonElement).addEventListener('click', close);
  (el.querySelector('[data-close]') as HTMLButtonElement).focus();
}

export function bindFrames(scope: ParentNode) {
  scope.querySelectorAll<HTMLButtonElement>('[data-full]').forEach((b) => b.addEventListener('click', () => openFullscreen(b.dataset.full!, b.dataset.title!)));
}

export function renderDesigns(cfg: AppConfig, v: ProjectView) {
  if (v.status !== 'directions_ready') return navigate(`/p/${v.id}`, true);
  const tabKey = `tab:${v.id}`;
  let tab = store.get<'a' | 'b'>(tabKey, 'a');
  const conflicts = v.facts.filter((f) => f.conflict && f.source !== 'owner');
  const label = (d: DesignVariantView) => `${d.key.toUpperCase()} · ${d.name}`;
  void api('POST', `/api/projects/${v.id}/viewed`).catch(() => {});
  const isDesktop = () => window.matchMedia('(min-width:980px)').matches;

  const paint = () => {
    const cur = v.variants.find((d) => d.key === tab)!;
    root().innerHTML = chrome(cfg, html`
<h1>Choose your homepage</h1>
<p class="lede">Same details, two different designs. Try them like a customer would: scroll, tap the menu, open the quote form.</p>
${conflicts.length ? html`<p class="notice warn">Please check: we found different ${conflicts.map((c) => (c.key === 'publicPhone' ? 'phone numbers' : c.key)).join(', ')} online. You can fix this after choosing, in <strong>Edit website</strong>.</p>` : ''}
<div class="mobile-only">
<div class="tabs" role="tablist" aria-label="Designs">
${v.variants.map((d) => html`<button role="tab" id="tab-${d.key}" aria-selected="${d.key === tab}" aria-controls="panel" data-tab="${d.key}">${label(d)}</button>`)}
</div>
<div id="panel" role="tabpanel" aria-labelledby="tab-${tab}">
<p class="muted small" style="margin:0 0 10px">${cur.summary}</p>
${isDesktop() ? '' : frame(cur.previewUrl, `Design ${label(cur)}`)}
</div></div>
<div class="side-by-side desktop-only">
${isDesktop() ? v.variants.map((d) => html`<div><h2>${label(d)}</h2><p class="muted small">${d.summary}</p>${frame(d.previewUrl, `Design ${label(d)}`, { lazy: true })}
<button class="btn btn-primary btn-block" style="margin-top:12px" data-choose="${d.key}">Choose ${d.name}</button></div>`) : ''}
</div>
<p class="small muted" style="margin-top:12px">Forms in the preview don’t send anything. ${cur && v.assets.some((a) => a.kind === 'photo') ? '' : 'Illustrations stand in until you add photos.'}</p>
<div class="actionbar mobile-only">
<button class="btn btn-primary btn-block" data-choose="${tab}">Choose ${cur.name}</button>
${v.regenerationsLeft > 0 ? html`<button class="btn-link" id="regen">Rebuild with my latest details (${v.regenerationsLeft} left)</button>` : ''}
</div>
${v.regenerationsLeft > 0 ? html`<p class="desktop-only"><button class="btn-link" id="regen-d">Rebuild with my latest details (${v.regenerationsLeft} left)</button></p>` : ''}
`, { step: 4, of: 4, wide: true, back: `/p/${v.id}/build`, backLabel: 'Back to progress' }).s;
    root().querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab as 'a' | 'b'; store.set(tabKey, tab); paint(); document.getElementById(`tab-${tab}`)?.focus(); }));
    root().querySelector('[role=tablist]')?.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { tab = tab === 'a' ? 'b' : 'a'; store.set(tabKey, tab); paint(); document.getElementById(`tab-${tab}`)?.focus(); }
    });
    bindFrames(root());
    root().querySelectorAll<HTMLButtonElement>('[data-choose]').forEach((b) => b.addEventListener('click', async () => {
      const r = await busy(b, 'Building your site…', () => api<ProjectView>('POST', `/api/projects/${v.id}/choose`, { variant: b.dataset.choose })).catch(() => null);
      if (r) navigate(`/p/${v.id}/site`);
    }));
    for (const id of ['regen', 'regen-d']) document.getElementById(id)?.addEventListener('click', async (e) => {
      const ok = await confirmSheet('Rebuild both designs?', html`<p>We’ll rebuild both directions using your latest details and photos. You have ${v.regenerationsLeft} free rebuild${v.regenerationsLeft === 1 ? '' : 's'} left. For anything more specific, choose a design and send a change request.</p>`, 'Rebuild');
      if (!ok) return;
      const r = await busy(e.target as HTMLButtonElement, 'Starting…', () => api<ProjectView>('POST', `/api/projects/${v.id}/regenerate`)).catch(() => null);
      if (r) { toast('Rebuilding. This takes a few minutes.'); navigate(`/p/${v.id}/build`); }
    });
  };
  const mq = window.matchMedia('(min-width:980px)');
  const onMq = () => paint();
  mq.addEventListener('change', onMq);
  onLeave(() => mq.removeEventListener('change', onMq));
  paint();
}
