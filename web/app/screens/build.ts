import { api, html, navigate, store, clock, fact, type Safe } from '../lib.ts';
import { chrome, root, onLeave, type AppConfig } from '../main.ts';
import { openNotifySheet } from './notify.ts';
import type { ProjectView, StageView } from '../../../shared/types.ts';
import { formatPhone } from '../../../shared/validate.ts';

const ACTIVE = ['queued', 'researching', 'building'];

function stageList(stages: StageView[]): Safe {
  const icon = (s: StageView) => (s.state === 'done' ? '✓' : s.state === 'failed' ? '!' : s.state === 'partial' ? '~' : s.state === 'waiting' ? '…' : '');
  const word: Record<string, string> = { done: 'Done', current: 'In progress', upcoming: 'Up next', failed: 'Problem', waiting: 'Waiting', partial: 'Done with gaps' };
  return html`<ol class="stages">${stages.map((s) => html`<li class="${s.state}" ${s.state === 'current' ? 'aria-current="step"' : ''}>
<span class="dot" aria-hidden="true">${icon(s)}</span>
<div><div class="label">${s.label} <span class="sr-only">(${word[s.state]})</span></div>${s.detail ? html`<div class="detail">${s.detail}</div>` : s.state === 'current' ? html`<div class="detail">Working on it…</div>` : ''}</div></li>`)}</ol>`;
}

function statusHeadline(v: ProjectView): [string, string] {
  switch (v.status) {
    case 'queued': return ['Your preview is in the queue', 'It will start in a moment. You can leave this page; the build keeps going.'];
    case 'researching': return ['We’re gathering your details', 'Reading the public sources for your business. You can leave this page; the build keeps going.'];
    case 'building': return ['We’re preparing your designs', 'Two homepage directions from the details you confirmed.'];
    case 'in_review': return ['Waiting for a quick review', 'A Blue Park team member checks your preview before we send it. We’ll message you when it’s ready.'];
    case 'needs_info': return ['We need a little more information', 'Add the missing details and we’ll continue right away.'];
    case 'failed': return ['Something went wrong on our side', 'Our team has been notified and will retry. Nothing is lost. You don’t need to start over.'];
    case 'directions_ready': return ['Your preview is ready', 'Two homepage directions are waiting for you.'];
    default: return ['Your preview', ''];
  }
}

export function renderBuild(cfg: AppConfig, initial: ProjectView) {
  let v = initial;
  if (['draft'].includes(v.status)) return navigate(`/p/${v.id}`, true);
  const waitKey = `wait:${v.id}`;
  let timer: number | undefined;
  let stopped = false;

  const notifyCard = (): Safe => {
    const n = v.notification;
    if (n.verified && n.channel !== 'none') {
      return html`<div class="card"><h2>We’ll ${n.channel === 'sms' ? 'text' : 'email'} you</h2>
<p class="muted" style="margin:0 0 6px">At ${n.destinationMasked} when your preview is ready. You can close this page.</p>
${cfg.mode === 'demo' ? html`<p class="small"><span class="badge sample">Demo</span> Notifications are simulated. Nothing is actually sent.</p>` : ''}
${v.notifications.filter((x) => x.status === 'failed').map((x) => html`<p class="notice error">We couldn’t deliver to ${x.destinationMasked}. <button class="btn-link" data-ch="${x.channel}">Update contact</button></p>`)}
<button class="btn-link" data-ch="${n.channel}">Change</button></div>`;
    }
    if (store.get(waitKey, false)) {
      return html`<div class="card"><h2>You’re waiting here</h2>
<p class="muted" style="margin:0 0 10px">This page updates by itself. If you close it, you can come back from this browser for a while. To return from another device, save your access.</p>
<div class="chips"><button class="chip" data-ch="sms">Text me instead</button><button class="chip" data-ch="email">Email me instead</button></div></div>`;
    }
    return html`<div class="card"><h2>Want a message when it’s ready?</h2>
<p class="muted" style="margin:0 0 12px">Then you can close this page. We’ll send a private link.</p>
<div class="stack"><button class="btn btn-quiet btn-block" data-ch="sms">Text me</button><button class="btn btn-quiet btn-block" data-ch="email">Email me</button><button class="btn-link" data-wait>I’ll wait here</button></div></div>`;
  };

  const known = (): Safe => {
    const rows: [string, unknown][] = [
      ['Name', fact(v, 'displayName')], ['Services', (fact(v, 'services') ?? []).join(', ')], ['Areas', (fact(v, 'areas') ?? []).join(', ')],
      ['Phone', formatPhone(fact(v, 'publicPhone'))], ['Email', fact(v, 'publicEmail')],
    ];
    return html`<dl class="kv">${rows.filter(([, val]) => val).map(([k, val]) => html`<dt>${k}</dt><dd>${val}</dd>`)}</dl>`;
  };

  const previewArea = (): Safe => {
    if (v.status === 'directions_ready') {
      return html`<div class="notice ok"><strong>Ready.</strong> Two homepage directions are waiting.</div>
<a class="btn btn-primary btn-block" href="/p/${v.id}/designs" data-link style="margin-top:12px">See my designs</a>`;
    }
    const designing = v.stages.find((s) => s.key === 'design')?.state;
    return html`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" aria-hidden="true">
${['A', 'B'].map((k) => html`<div class="card" style="padding:10px"><p class="small muted" style="margin:0 0 8px">Direction ${k}${designing === 'done' ? ' · prepared' : ''}</p>
<div class="skel" style="height:110px;margin-bottom:8px"></div><div class="skel" style="height:12px;width:80%;margin-bottom:6px"></div><div class="skel" style="height:12px;width:55%"></div></div>`)}</div>
<p class="small muted">Previews appear here when they pass our checks.</p>`;
  };

  const paint = () => {
    const [h, sub] = statusHeadline(v);
    root().innerHTML = chrome(cfg, html`
<div aria-live="polite" id="headline"><h1>${h}</h1><p class="lede">${sub}</p></div>
${v.status === 'needs_info' ? html`<div class="notice warn" style="margin-bottom:14px">Missing: <strong>${v.needsInfo.join(', ')}</strong></div><a class="btn btn-primary btn-block" href="/p/${v.id}/details" data-link>Add the missing details</a>` : ''}
<div class="card" style="margin:16px 0"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
<div><p class="biz-name" style="font-size:20px">${v.businessName}</p><p class="muted small" style="margin:2px 0 0">${v.city ?? ''}${v.candidate ? ` · ${v.candidate.sourceLabel}` : ''}</p></div>
<span class="badge ok">Confirmed</span></div></div>
<div class="card"><h2 class="sr-only">Progress</h2><div id="stages">${stageList(v.stages)}</div></div>
<div class="card" id="preview-area">${previewArea()}</div>
<div id="notify">${notifyCard()}</div>
<details class="section" style="margin-top:14px" ${ACTIVE.includes(v.status) ? 'open' : ''}><summary>Activity${cfg.mode === 'demo' ? ' (simulated demo events)' : ''}</summary><div class="body">
<ul class="feed" id="feed">${v.events.slice(-12).reverse().map((e) => html`<li><time datetime="${e.at}">${clock(e.at)}</time><span class="${e.level}">${e.message}${e.simulated ? html` <span class="badge sample">simulated</span>` : ''}</span></li>`)}</ul></div></details>
<details class="section"><summary>What we know so far</summary><div class="body">${known()}</div></details>
<p class="small muted">Questions? Tap <strong>Help</strong> at the top. Your build continues even if you close this page.</p>
${v.status === 'directions_ready' ? html`<div class="actionbar"><a class="btn btn-primary btn-block" href="/p/${v.id}/designs" data-link>See my designs</a></div>` : ''}
`, { step: 3, of: 4, helpProjectId: v.id }).s;
    root().querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => b.addEventListener('click', () => openNotifySheet(v.id, b.dataset.ch as 'sms' | 'email', (nv) => { v = nv; paint(); })));
    root().querySelector('[data-wait]')?.addEventListener('click', () => { store.set(waitKey, true); paint(); });
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const nv = await api<ProjectView>('GET', `/api/projects/${v.id}`);
      const changed = nv.updatedAt !== v.updatedAt || nv.status !== v.status;
      v = nv;
      if (changed && !document.querySelector('dialog.sheet')) paint();
    } catch {
      /* transient; keep polling with backoff */
    }
    const active = ACTIVE.includes(v.status) || v.status === 'in_review';
    if (!active && v.status !== 'failed') return;
    timer = window.setTimeout(poll, document.hidden ? 10000 : v.status === 'in_review' || v.status === 'failed' ? 15000 : 1500);
  };
  const onVis = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
  document.addEventListener('visibilitychange', onVis);
  onLeave(() => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); });
  paint();
  timer = window.setTimeout(poll, 1200);
}
