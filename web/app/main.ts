import { api, html, setRouter, navigate, watchKeyboard, watchOnline, LOGO, type Safe } from './lib.ts';
import type { ProjectView } from '../../shared/types.ts';
import type { OfferConfig } from '../../shared/offer.ts';

export interface AppConfig {
  mode: 'demo' | 'live';
  offer: OfferConfig;
  settings: { previewTargetBusinessDays: number; updateTurnaroundBusinessDays: number };
  integrations: Record<string, string>;
}

let cfgPromise: Promise<AppConfig> | null = null;
export const getConfig = () => (cfgPromise ??= api<AppConfig>('GET', '/api/config'));

export const root = () => document.getElementById('app')!;

export interface ChromeOpts {
  step?: number;
  of?: number;
  back?: string | null;
  backLabel?: string;
  wide?: boolean;
  helpProjectId?: string | null;
}

export function chrome(cfg: AppConfig, body: Safe, o: ChromeOpts = {}): Safe {
  const pct = o.step && o.of ? Math.round((o.step / o.of) * 100) : 0;
  return html`
${cfg.mode === 'demo' ? html`<div class="demo-bar" role="note"><strong>Demo mode.</strong> Sample data only. Nothing is sent, charged or published.</div>` : ''}
<header class="topbar"><div class="in">
${o.back ? html`<a class="icon-btn" href="${o.back}" data-link aria-label="${o.backLabel ?? 'Back'}">←</a>` : html`<a class="logo" href="/">${LOGO}<span>Blue Park</span></a>`}
<div class="grow">${o.step ? html`<span class="step-label">Step ${o.step} of ${o.of}</span>` : ''}</div>
<button class="icon-btn" data-help type="button" aria-haspopup="dialog">Help</button>
</div>${o.step ? html`<div class="progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>` : ''}</header>
<main id="main" class="${o.wide ? 'wide' : ''}" tabindex="-1">${body}</main>`;
}

/** Map a project's state to the screen the owner should see next. */
export function nextPath(v: ProjectView): string {
  const id = v.id;
  switch (v.status) {
    case 'draft':
      return v.candidate ? `/p/${id}/details` : `/p/${id}/confirm`;
    case 'needs_info':
      return `/p/${id}/details`;
    case 'queued': case 'researching': case 'building': case 'in_review': case 'failed':
      return v.variants.length && v.status === 'failed' && v.chosenVariant ? `/p/${id}/site` : `/p/${id}/build`;
    case 'directions_ready':
      return `/p/${id}/designs`;
    case 'site_building': case 'site_ready':
      return `/p/${id}/site`;
    case 'paid': case 'launching':
      return `/p/${id}/launch`;
    case 'live': case 'cancelled':
      return `/app?p=${id}`;
  }
}

let cleanup: (() => void) | null = null;
export function onLeave(fn: () => void) {
  cleanup = fn;
}

async function route() {
  cleanup?.();
  cleanup = null;
  const path = location.pathname;
  const cfg = await getConfig().catch(() => null);
  if (!cfg) {
    root().innerHTML = `<main id="main"><h1>We can’t reach Blue Park</h1><p>Check your connection and reload the page.</p><button class="btn btn-primary" data-reload>Reload</button></main>`;
    return;
  }
  const m = path.match(/^\/p\/([\w-]+)(?:\/(\w+))?\/?$/);
  try {
    if (path === '/start') return (await import('./screens/start.ts')).renderStart(cfg);
    if (path === '/signin') return (await import('./screens/signin.ts')).renderSignin(cfg);
    if (path.startsWith('/app')) return (await import('./screens/dashboard.ts')).renderDashboard(cfg, path);
    if (m) {
      const [, id, step] = m;
      const view = await api<ProjectView>('GET', `/api/projects/${id}`);
      if (!step) return navigate(nextPath(view), true);
      switch (step) {
        case 'confirm': return (await import('./screens/start.ts')).renderConfirm(cfg, view);
        case 'details': return (await import('./screens/details.ts')).renderDetails(cfg, view);
        case 'build': return (await import('./screens/build.ts')).renderBuild(cfg, view);
        case 'designs': return (await import('./screens/designs.ts')).renderDesigns(cfg, view);
        case 'site': return (await import('./screens/site.ts')).renderSite(cfg, view);
        case 'edit': return (await import('./screens/edit.ts')).renderEdit(cfg, view);
        case 'launch': return (await import('./screens/launch.ts')).renderLaunch(cfg, view);
      }
    }
    root().innerHTML = chrome(cfg, html`<h1>Page not found</h1><p><a href="/start" data-link>Find your business</a></p>`).s;
  } catch (e: any) {
    const forbidden = e?.status === 403 || e?.status === 404;
    root().innerHTML = chrome(cfg, html`<h1>${forbidden ? 'This preview is private' : 'Something went wrong'}</h1>
<p class="lede">${forbidden ? 'Sign in with the email or phone number you saved, and we’ll take you to your preview.' : e?.message ?? 'Please try again.'}</p>
<div class="stack">${forbidden ? html`<a class="btn btn-primary btn-block" href="/signin" data-link>Sign in</a>` : html`<button class="btn btn-primary btn-block" data-reload>Try again</button>`}
<a class="btn btn-quiet btn-block" href="/start" data-link>Start a new preview</a></div>`).s;
  }
  document.getElementById('main')?.removeAttribute('aria-busy');
}

// Help is available from every screen.
document.addEventListener('click', async (e) => {
  if ((e.target as Element).closest?.('[data-reload]')) return location.reload();
  if (!(e.target as Element).closest?.('[data-help]')) return;
  const { openHelp } = await import('./screens/help.ts');
  openHelp(await getConfig(), location.pathname.match(/^\/p\/([\w-]+)/)?.[1] ?? new URLSearchParams(location.search).get('p'));
});

watchKeyboard();
watchOnline();
setRouter(() => void route());
void route();
