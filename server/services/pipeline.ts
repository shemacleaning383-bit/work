// Build pipeline. Each stage is its own durable job; a failed stage can be
// retried in place without redoing earlier stages. Every customer-visible
// stage change is backed by an event written here — nothing is faked.
import type { Ctx } from '../ctx.ts';
import { pace } from '../ctx.ts';
import { now, j, pj } from '../db.ts';
import { enqueue, PermanentError, type Job, type Handler } from './jobs.ts';
import { event, setStage, track, audit } from './events.ts';
import {
  getProject, transition, recordSource, contentFromFacts, createVersion, currentVersion, privateContacts, requirePreviewReview,
} from './projects.ts';
import { effectiveFacts, missingEssentials, factViews } from './facts.ts';
import { renderPage, sitePages, VARIANTS, type Variant, type SiteContent } from './sitegen.ts';
import { checkPage, type QaResult } from './quality.ts';
import { queueNotification } from './notify.ts';
import { handleNotify } from './notify.ts';
import { getSettings } from './settings.ts';
import type { CandidateInternal } from '../adapters/types.ts';

function stale(ctx: Ctx, job: Job): boolean {
  // A newer build superseded this one (e.g. owner rebuilt); drop quietly.
  const p = getProject(ctx, job.project_id);
  return job.payload.buildNo != null && Number(job.payload.buildNo) !== Number(p.build_no);
}

const research: Handler = async (ctx, job) => {
  if (stale(ctx, job)) return;
  const p = getProject(ctx, job.project_id);
  const cand = pj<CandidateInternal | null>(p.candidate_json, null);
  if (!cand) throw new PermanentError('No confirmed candidate');
  transition(ctx, p.id, 'researching');
  setStage(ctx, p.id, 'gather', 'current');
  event(ctx, p.id, 'gather', 'info', `Looking up public information for ${cand.name}.`, { jobId: job.id });
  await pace(ctx, 0.6);

  // Re-research replaces earlier non-initial snapshots for this match (keeps owner facts untouched).
  const res = await ctx.adapters.research.research(cand);
  ctx.db.tx(() => {
    const keepInitial = ctx.db.get('SELECT id FROM source_snapshots WHERE project_id = ? AND match_id = ? ORDER BY fetched_at LIMIT 1', p.id, cand.id);
    const old = ctx.db.all('SELECT id FROM source_snapshots WHERE project_id = ? AND match_id = ? AND id != ?', p.id, cand.id, keepInitial?.id ?? '');
    for (const o of old) {
      ctx.db.run('DELETE FROM observations WHERE snapshot_id = ?', o.id);
      ctx.db.run('DELETE FROM source_snapshots WHERE id = ?', o.id);
    }
  });
  let failed = 0;
  for (const s of res.sources) {
    if (s === cand.initialSource || (s.url === cand.initialSource.url && s.kind === cand.initialSource.kind)) {
      event(ctx, p.id, 'gather', 'info', `Read ${s.label}.`, { jobId: job.id });
      continue;
    }
    recordSource(ctx, p.id, cand.id, s);
    if (s.status === 'ok') event(ctx, p.id, 'gather', 'info', `Read ${s.label}.`, { jobId: job.id });
    else {
      failed++;
      event(ctx, p.id, 'gather', 'warn', `Couldn’t read ${s.label}. We’ll continue with the other sources.`, { jobId: job.id, internal: s.error });
    }
    await pace(ctx, 0.35);
  }
  ctx.db.run('UPDATE projects SET cost_cents = cost_cents + ? WHERE id = ?', res.costCents, p.id);
  const okCount = res.sources.filter((s) => s.status === 'ok').length;
  setStage(ctx, p.id, 'gather', failed ? 'partial' : 'done', failed ? `${okCount} of ${res.sources.length} sources read` : `${okCount} source${okCount === 1 ? '' : 's'} read`);
  enqueue(ctx, { projectId: p.id, type: 'organize', key: `build:${p.id}:${p.build_no}:organize`, payload: { buildNo: p.build_no } });
};

const organize: Handler = async (ctx, job) => {
  if (stale(ctx, job)) return;
  const p = getProject(ctx, job.project_id);
  if (p.status === 'queued') transition(ctx, p.id, 'researching');
  setStage(ctx, p.id, 'organize', 'current');
  await pace(ctx, 0.6);
  const facts = effectiveFacts(ctx, p.id);
  const missing = missingEssentials(facts);
  if (missing.length) {
    ctx.db.run('UPDATE projects SET needs_info_json = ? WHERE id = ?', j(missing), p.id);
    transition(ctx, p.id, 'needs_info');
    setStage(ctx, p.id, 'organize', 'waiting', 'Waiting for your details');
    event(ctx, p.id, 'organize', 'warn', `We need a little more information: ${missing.join(', ')}.`, { jobId: job.id });
    queueNotification(ctx, p.id, 'needs_info', `needs_info:${p.id}:${p.build_no}`);
    return;
  }
  const conflicts = factViews(ctx, p.id).filter((f) => f.conflict && f.source !== 'owner');
  event(ctx, p.id, 'organize', 'info', `Organized ${facts.services.length} service${facts.services.length === 1 ? '' : 's'} and ${facts.areas.length} service area${facts.areas.length === 1 ? '' : 's'}.`, { jobId: job.id });
  if (conflicts.length) event(ctx, p.id, 'organize', 'warn', `Some public details disagree (${conflicts.map((c) => c.key === 'publicPhone' ? 'phone number' : c.key).join(', ')}). We used the first source and flagged it for you to check.`, { jobId: job.id });
  const photos = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM assets WHERE project_id = ? AND kind = 'photo' AND deleted_at IS NULL`, p.id)!.n;
  event(ctx, p.id, 'organize', 'info', photos ? `Using your ${photos} photo${photos === 1 ? '' : 's'}.` : 'No photos yet, so we’ll use simple illustrations. You can add real photos anytime.', { jobId: job.id });
  setStage(ctx, p.id, 'organize', 'done');
  enqueue(ctx, { projectId: p.id, type: 'compose', key: `build:${p.id}:${p.build_no}:compose`, payload: { buildNo: p.build_no } });
};

const compose: Handler = async (ctx, job) => {
  if (stale(ctx, job)) return;
  const p = getProject(ctx, job.project_id);
  transition(ctx, p.id, 'building');
  setStage(ctx, p.id, 'design', 'current');
  const prev = currentVersion(ctx, p.id)?.content ?? null;
  const content = contentFromFacts(ctx, p.id, 'a', prev);
  for (const v of ['a', 'b'] as Variant[]) {
    await pace(ctx, 0.7);
    event(ctx, p.id, 'design', 'info', `Prepared direction ${v.toUpperCase()}: ${VARIANTS[v].name}.`, { jobId: job.id });
  }
  createVersion(ctx, p.id, content, `Homepage directions (build ${p.build_no})`, 'system');
  setStage(ctx, p.id, 'design', 'done', 'Two directions prepared');
  enqueue(ctx, { projectId: p.id, type: 'qa', key: `build:${p.id}:${p.build_no}:qa`, payload: { buildNo: p.build_no } });
};

export function renderAll(ctx: Ctx, projectId: string, content: SiteContent, scope: 'direction' | 'site', variants: Variant[]): QaResult[] {
  const priv = privateContacts(ctx, projectId);
  const results: QaResult[] = [];
  for (const v of variants) {
    const c = { ...content, variant: v };
    const pages = scope === 'direction' ? [{ slug: '' }] : sitePages(c);
    for (const pg of pages) {
      const html = renderPage(c, { page: pg.slug, mode: 'live', scope, link: (s) => `/${s}`, inquiryAction: '/inquiry' });
      results.push(checkPage(c, `${v}:/${pg.slug}`, html, priv));
    }
  }
  return results;
}

const qa: Handler = async (ctx, job) => {
  if (stale(ctx, job)) return;
  const p = getProject(ctx, job.project_id);
  setStage(ctx, p.id, 'qa', 'current');
  await pace(ctx, 0.8);
  const cur = currentVersion(ctx, p.id);
  if (!cur) throw new PermanentError('No version to check');
  const results = renderAll(ctx, p.id, cur.content, 'direction', ['a', 'b']);
  ctx.db.run('UPDATE site_versions SET qa_json = ? WHERE id = ?', j(results), cur.id);
  const errors = results.flatMap((r) => r.errors.map((e) => `${r.page} ${e}`));
  if (errors.length) {
    setStage(ctx, p.id, 'qa', 'failed', 'A quality check failed');
    throw new PermanentError(`QA failed: ${errors.join('; ')}`, 'A quality check didn’t pass. Our team will fix it and continue.');
  }
  event(ctx, p.id, 'qa', 'success', 'Checked mobile layout rules, tap-to-call, headings, image text and wording.', { jobId: job.id });
  setStage(ctx, p.id, 'qa', 'done');
  if (requirePreviewReview(ctx) && !p.preview_approved_at) {
    transition(ctx, p.id, 'in_review');
    setStage(ctx, p.id, 'ready', 'waiting', 'Waiting for a quick review by the Blue Park team');
    event(ctx, p.id, 'ready', 'info', 'Your preview is waiting for a quick review by our team before we send it.', { jobId: job.id });
    return;
  }
  deliverPreview(ctx, p.id);
};

export function deliverPreview(ctx: Ctx, projectId: string) {
  const p = getProject(ctx, projectId);
  transition(ctx, projectId, 'directions_ready');
  setStage(ctx, projectId, 'ready', 'done');
  event(ctx, projectId, 'ready', 'success', 'Your two homepage directions are ready.');
  queueNotification(ctx, projectId, 'preview_ready', `preview_ready:${projectId}:${p.build_no}`);
  track(ctx, 'preview_ready', projectId);
}

const buildSite: Handler = async (ctx, job) => {
  const p = getProject(ctx, job.project_id);
  const variant = job.payload.variant as Variant;
  if (p.chosen_variant !== variant) return; // owner switched; a newer job handles it
  const cur = currentVersion(ctx, p.id);
  if (!cur) throw new PermanentError('No content version');
  const content: SiteContent = { ...cur.content, variant };
  for (const pg of sitePages(content)) {
    await pace(ctx, 0.45);
    event(ctx, p.id, 'site', 'info', `Built the ${pg.title} page.`, { jobId: job.id });
  }
  const results = renderAll(ctx, p.id, content, 'site', [variant]);
  const errors = results.flatMap((r) => r.errors.map((e) => `${r.page} ${e}`));
  if (errors.length) throw new PermanentError(`QA failed: ${errors.join('; ')}`, 'A quality check didn’t pass on the full site. Our team will fix it.');
  createVersion(ctx, p.id, content, `Full site (${VARIANTS[variant].name} design)`, 'system', 'current', results);
  transition(ctx, p.id, 'site_ready');
  event(ctx, p.id, 'site', 'success', `Your full ${sitePages(content).length}-page site preview is ready.`, { jobId: job.id });
  queueNotification(ctx, p.id, 'site_ready', `site_ready:${p.id}:${cur.id}:${variant}`);
  track(ctx, 'site_ready', p.id, { variant });
};

const launch: Handler = async (ctx, job) => {
  const p = getProject(ctx, job.project_id);
  if (p.status === 'live' && !job.payload.republish) return;
  const sub = ctx.db.get('SELECT status FROM subscriptions WHERE project_id = ?', p.id);
  if (!sub || !['active', 'cancel_scheduled'].includes(sub.status)) {
    event(ctx, p.id, 'launch', 'warn', 'Launch is waiting for a confirmed subscription.', { jobId: job.id });
    return;
  }
  if (!p.launch_approved_at) {
    event(ctx, p.id, 'launch', 'warn', 'Launch is waiting for your approval.', { jobId: job.id });
    return;
  }
  if (getSettings(ctx).requireLaunchReview && !p.launch_reviewed_at) {
    event(ctx, p.id, 'launch', 'info', 'Payment confirmed. A Blue Park team member will do a final check before your site goes live.', { jobId: job.id });
    return;
  }
  const cur = currentVersion(ctx, p.id);
  if (!cur || !p.chosen_variant) throw new PermanentError('Nothing to publish');
  const content: SiteContent = { ...cur.content, variant: p.chosen_variant };
  const results = renderAll(ctx, p.id, content, 'site', [p.chosen_variant]);
  const errors = results.flatMap((r) => r.errors);
  if (errors.length) throw new PermanentError(`Launch QA failed: ${errors.join('; ')}`, 'A final quality check failed. Our team is on it.');
  if (p.status !== 'launching') transition(ctx, p.id, 'launching');
  event(ctx, p.id, 'launch', 'info', 'Publishing your site.', { jobId: job.id });
  await pace(ctx, 0.6);
  const slug = p.live_slug as string;
  const domain = ctx.db.get('SELECT domain, status, mode FROM domains WHERE project_id = ?', p.id);
  const useDomain = domain?.mode === 'custom' && domain.status === 'verified' ? domain.domain : null;
  const pages: Record<string, string> = {};
  for (const pg of sitePages(content)) pages[pg.slug] = renderPage(content, { page: pg.slug, mode: 'live', scope: 'site', link: (s) => `/sites/${slug}/${s}`, inquiryAction: `/sites/${slug}/inquiry` });
  const { url } = await ctx.adapters.publish.publish({ projectId: p.id, slug, domain: useDomain, pages });
  const ok = await ctx.adapters.publish.verify(url);
  if (!ok) {
    transition(ctx, p.id, 'paid');
    throw new PermanentError(`Public URL check failed for ${url}`, 'We published the site but couldn’t confirm the public address works yet. Our team is checking.');
  }
  ctx.db.run('UPDATE projects SET live_url = ?, updated_at = ? WHERE id = ?', url, now(), p.id);
  ctx.db.run(`UPDATE site_versions SET qa_json = ? WHERE id = ?`, j(results), cur.id);
  transition(ctx, p.id, 'live');
  event(ctx, p.id, 'launch', 'success', ctx.adapters.publish.simulated
    ? 'Your site is live on demo hosting (this server only, not the public internet).'
    : `Your site is live at ${url}.`, { jobId: job.id });
  if (domain?.mode === 'custom' && domain.status !== 'verified') event(ctx, p.id, 'launch', 'info', 'Your own domain isn’t connected yet. The site is on your Blue Park address until DNS is verified.', { jobId: job.id });
  queueNotification(ctx, p.id, 'launched', `launched:${p.id}:${cur.id}`);
  audit(ctx, p.id, 'system', 'launched', { url });
  track(ctx, 'launched', p.id);
};

export const HANDLERS: Record<string, Handler> = {
  research, organize, compose, qa, build_site: buildSite, launch, notify: handleNotify,
};

const STAGE_OF: Record<string, string> = { research: 'gather', organize: 'organize', compose: 'design', qa: 'qa', build_site: 'site', launch: 'launch' };

export function onJobFailure(ctx: Ctx, job: Job, err: unknown, willRetry: boolean) {
  const internal = err instanceof Error ? err.message : String(err);
  if (job.type === 'notify') return; // recorded on the notification itself
  const stage = STAGE_OF[job.type] ?? 'site';
  if (willRetry) {
    event(ctx, job.project_id, stage, 'warn', 'That step hit a problem. Retrying automatically.', { jobId: job.id, internal });
    return;
  }
  const publicMsg = err instanceof PermanentError ? err.publicMessage : 'This step failed after several tries. Our team has been notified and can retry it.';
  event(ctx, job.project_id, stage, 'error', publicMsg, { jobId: job.id, internal });
  try {
    const p = getProject(ctx, job.project_id);
    if (['gather', 'organize', 'design', 'qa'].includes(stage)) setStage(ctx, p.id, stage as any, 'failed');
    if (job.type !== 'launch' && !['failed', 'cancelled', 'live', 'paid'].includes(p.status)) transition(ctx, p.id, 'failed');
    if (job.type === 'launch' && p.status === 'launching') transition(ctx, p.id, 'paid');
  } catch {
    /* project may be gone */
  }
}
