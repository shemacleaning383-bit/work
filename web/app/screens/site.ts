import { api, html, navigate, clock } from '../lib.ts';
import { chrome, root, onLeave, type AppConfig } from '../main.ts';
import { frame, bindFrames } from './designs.ts';
import type { ProjectView } from '../../../shared/types.ts';

export function renderSite(cfg: AppConfig, initial: ProjectView) {
  let v = initial;
  let page = new URLSearchParams(location.search).get('page') ?? '';
  let timer: number | undefined;
  if (!['site_building', 'site_ready', 'paid', 'launching', 'live', 'failed'].includes(v.status)) return navigate(`/p/${v.id}`, true);

  const paint = () => {
    const building = v.status === 'site_building' || (v.status === 'failed' && !v.sitePages.length);
    const name = v.variants.find((d) => d.key === v.chosenVariant)?.name ?? '';
    if (building) {
      const siteEvents = v.events.filter((e) => e.stage === 'site').slice(-8);
      root().innerHTML = chrome(cfg, html`
<h1>${v.status === 'failed' ? 'We hit a problem building your site' : 'Building your full site'}</h1>
<p class="lede">${v.status === 'failed' ? 'Our team has been notified and will retry. Nothing you chose is lost.' : `You chose the ${name} design. We’re building the rest of the pages from it. Only the homepage exists so far.`}</p>
<div class="card"><ul class="feed">${siteEvents.length ? siteEvents.map((e) => html`<li><time>${clock(e.at)}</time><span class="${e.level}">${e.message}${e.simulated ? html` <span class="badge sample">simulated</span>` : ''}</span></li>`) : html`<li><span></span><span>Starting…</span></li>`}</ul></div>
<p class="small muted">You can leave this page. ${v.notification.verified ? `We’ll message you at ${v.notification.destinationMasked} when it’s ready.` : ''}</p>`, { back: `/p/${v.id}/build`, wide: false }).s;
      timer = window.setTimeout(async () => {
        try { v = await api<ProjectView>('GET', `/api/projects/${v.id}`); } catch { /* retry */ }
        paint();
      }, document.hidden ? 8000 : 1500);
      return;
    }
    const pages = v.sitePages;
    const cur = pages.find((p) => p.slug === page) ?? pages[0];
    const src = `/preview/${v.id}/${v.chosenVariant}/${cur.slug}`;
    root().innerHTML = chrome(cfg, html`
<p class="step-label">Full site preview · ${name} design</p>
<h1>Your ${pages.length}-page website</h1>
<p class="lede">Tap through the pages. Edit anything, then launch when you’re ready.</p>
<nav class="page-chips" aria-label="Pages">${pages.map((p) => html`<button class="chip" type="button" data-page="${p.slug}" aria-pressed="${p.slug === cur.slug}">${p.title}</button>`)}</nav>
${frame(src, `${cur.title} page preview`)}
<p class="small muted" style="margin-top:10px">Private preview. The quote form is preview-only and won’t send anything.</p>
<div class="actionbar">
${v.status === 'site_ready' ? html`<a class="btn btn-primary btn-block" href="/p/${v.id}/launch" data-link>Review plan &amp; launch</a>` : html`<a class="btn btn-primary btn-block" href="/app?p=${v.id}" data-link>Go to dashboard</a>`}
<div class="row" style="grid-template-columns:1fr 1fr"><a class="btn btn-quiet" href="/p/${v.id}/edit" data-link>Edit website</a><a class="btn btn-quiet" href="/p/${v.id}/edit#request" data-link>Request a change</a></div>
</div>`, { wide: true, back: '/app?p=' + v.id, backLabel: 'Dashboard' }).s;
    root().querySelectorAll<HTMLButtonElement>('[data-page]').forEach((b) => b.addEventListener('click', () => {
      page = b.dataset.page!;
      history.replaceState(null, '', `/p/${v.id}/site${page ? `?page=${page}` : ''}`);
      paint();
    }));
    bindFrames(root());
  };
  onLeave(() => clearTimeout(timer));
  paint();
}
