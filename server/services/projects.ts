import type { Ctx } from '../ctx.ts';
import { now, newId, j, pj, type Row } from '../db.ts';
import type {
  ProjectStatus, ProjectView, Candidate, StageView, JobEventView, AssetView, NotificationView,
  SiteVersionView, ChangeRequestView, SubscriptionView, DomainView,
} from '../../shared/types.ts';
import type { CandidateInternal, SourceResult } from '../adapters/types.ts';
import type { ClassifiedIdentifier } from '../../shared/validate.ts';
import { maskEmail, maskPhone } from '../../shared/validate.ts';
import { STAGES, event, setStage, resetStages, audit, track } from './events.ts';
import { factViews, effectiveFacts, ownerFacts, missingEssentials } from './facts.ts';
import { enqueue, cancelProjectJobs } from './jobs.ts';
import { buildContent, sitePages, VARIANTS, type SiteContent, type Variant } from './sitegen.ts';
import { getSettings } from './settings.ts';
import { config } from '../config.ts';

export class UserError extends Error {
  code: string;
  status: number;
  field?: string;
  constructor(message: string, code = 'bad_request', status = 400, field?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['queued', 'cancelled'],
  queued: ['researching', 'building', 'in_review', 'directions_ready', 'failed', 'cancelled', 'needs_info'],
  researching: ['building', 'needs_info', 'failed', 'cancelled', 'queued'],
  building: ['in_review', 'directions_ready', 'failed', 'cancelled', 'needs_info'],
  needs_info: ['queued', 'cancelled'],
  in_review: ['directions_ready', 'queued', 'failed', 'cancelled'],
  directions_ready: ['site_building', 'queued', 'cancelled'],
  site_building: ['site_ready', 'failed', 'cancelled'],
  site_ready: ['paid', 'site_building', 'cancelled'],
  paid: ['launching', 'cancelled'],
  launching: ['live', 'paid', 'cancelled'],
  live: ['cancelled', 'launching'],
  failed: ['queued', 'site_building', 'cancelled'],
  cancelled: [],
};

export function canTransition(from: ProjectStatus, to: ProjectStatus) {
  return from === to || TRANSITIONS[from].includes(to);
}

export function transition(ctx: Ctx, projectId: string, to: ProjectStatus, actor = 'system') {
  const p = getProject(ctx, projectId);
  if (!canTransition(p.status, to)) throw new UserError(`This project can’t move from ${p.status} to ${to}.`, 'invalid_state', 409);
  if (p.status === to) return;
  ctx.db.run('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?', to, now(), projectId);
  audit(ctx, projectId, actor, 'status', { from: p.status, to });
}

export function getProject(ctx: Ctx, id: string): Row & { status: ProjectStatus } {
  const p = ctx.db.get('SELECT * FROM projects WHERE id = ?', id);
  if (!p) throw new UserError('Project not found.', 'not_found', 404);
  return p as any;
}

export function createProject(ctx: Ctx, sessionId: string, query: string, kind: string): string {
  const id = newId('prj');
  ctx.db.run(
    'INSERT INTO projects (id, session_id, status, mode, intake_query, intake_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, sessionId, 'draft', ctx.mode, query, kind, now(), now(),
  );
  track(ctx, 'intake_started', id, { kind, mode: ctx.mode });
  return id;
}

export async function runLookup(ctx: Ctx, projectId: string, id: ClassifiedIdentifier, rawQuery: string) {
  const p = getProject(ctx, projectId);
  if (p.status !== 'draft') throw new UserError('This preview is already being built.', 'invalid_state', 409);
  let result;
  try {
    result = await ctx.adapters.lookup.lookup(id);
  } catch (e: any) {
    result = { status: 'error' as const, candidates: [], message: e?.code === 'unsafe_url' ? e.message : 'Lookup failed. Please try again or describe your business manually.' };
  }
  ctx.db.run('UPDATE projects SET intake_query = ?, intake_kind = ?, candidates_json = ?, updated_at = ? WHERE id = ?',
    rawQuery, id.kind, j(result.candidates), now(), projectId);
  track(ctx, 'lookup_result', projectId, { result: result.status, count: result.candidates.length, kind: id.kind });
  return { status: result.status, message: result.message ?? null, candidates: result.candidates.map(publicCandidate) };
}

export function publicCandidate(c: CandidateInternal | Candidate): Candidate {
  const { businessKey: _b, initialSource: _s, ...pub } = c as CandidateInternal;
  return pub;
}

function clearMatchData(ctx: Ctx, projectId: string) {
  // A rejected/changed match must not leak its facts into the next build.
  ctx.db.run('DELETE FROM observations WHERE project_id = ?', projectId);
  ctx.db.run('DELETE FROM source_snapshots WHERE project_id = ?', projectId);
  ctx.db.run('DELETE FROM owner_facts WHERE project_id = ?', projectId);
  ctx.db.run('DELETE FROM site_versions WHERE project_id = ?', projectId);
  ctx.db.run('DELETE FROM stage_state WHERE project_id = ?', projectId);
}

export function recordSource(ctx: Ctx, projectId: string, matchId: string, s: SourceResult): string {
  const sid = newId('src');
  ctx.db.run(
    'INSERT INTO source_snapshots (id, project_id, match_id, kind, label, url, status, fetched_at, summary_json, screenshot_path, error, is_sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    sid, projectId, matchId, s.kind, s.label, s.url ?? null, s.status, now(), j(s.observations), s.screenshotPath ?? null, s.error ?? null, s.isSample ? 1 : 0,
  );
  for (const [k, v] of Object.entries(s.observations)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    ctx.db.run('INSERT INTO observations (project_id, match_id, snapshot_id, key, value_json, observed_at) VALUES (?, ?, ?, ?, ?, ?)', projectId, matchId, sid, k, j(v), now());
  }
  return sid;
}

export function confirmCandidate(ctx: Ctx, projectId: string, candidateId: string) {
  const p = getProject(ctx, projectId);
  if (p.status !== 'draft') throw new UserError('This business is already confirmed for this preview.', 'invalid_state', 409);
  const list = pj<CandidateInternal[]>(p.candidates_json, []);
  const c = list.find((x) => x.id === candidateId);
  if (!c) throw new UserError('That business is no longer in the results. Please search again.', 'not_found', 404);
  if (p.match_id === c.id) return; // idempotent double tap
  ctx.db.tx(() => {
    clearMatchData(ctx, projectId);
    ctx.db.run('UPDATE projects SET candidate_json = ?, match_id = ?, business_key = ?, updated_at = ? WHERE id = ?', j(c), c.id, c.businessKey, now(), projectId);
    recordSource(ctx, projectId, c.id, c.initialSource);
    setStage(ctx, projectId, 'confirmed', 'done', c.name);
    event(ctx, projectId, 'confirmed', 'success', `You confirmed ${c.name}.`);
  });
  track(ctx, 'business_confirmed', projectId, { source: c.sourceKind });
}

export function rejectMatch(ctx: Ctx, projectId: string) {
  const p = getProject(ctx, projectId);
  if (p.status !== 'draft') throw new UserError('The build has already started. Contact support to change the business.', 'invalid_state', 409);
  ctx.db.tx(() => {
    clearMatchData(ctx, projectId);
    ctx.db.run('UPDATE projects SET candidate_json = NULL, match_id = NULL, business_key = NULL, facts_confirmed_at = NULL, updated_at = ? WHERE id = ?', now(), projectId);
  });
  track(ctx, 'business_rejected', projectId);
}

export function startManual(ctx: Ctx, projectId: string, name: string, city: string) {
  const p = getProject(ctx, projectId);
  if (p.status !== 'draft') throw new UserError('This preview is already being built.', 'invalid_state', 409);
  const c: CandidateInternal = {
    id: `manual_${newId('m').slice(2)}`,
    businessKey: `manual:${name.toLowerCase().trim()}|${city.toLowerCase().trim()}`,
    name, city, sourceKind: 'manual', sourceLabel: 'Entered by you', screenshotUrl: null,
    screenshotNote: 'No online listing; you entered these details.', foundAt: now(), rating: null, isSample: false, confidence: 'exact',
    initialSource: { kind: 'owner', label: 'Entered by you', status: 'ok', observations: { displayName: name, city, areas: city ? [city] : [] }, isSample: false },
  };
  ctx.db.tx(() => {
    clearMatchData(ctx, projectId);
    ctx.db.run('UPDATE projects SET candidates_json = ?, candidate_json = ?, match_id = ?, business_key = ?, updated_at = ? WHERE id = ?', j([c]), j(c), c.id, c.businessKey, now(), projectId);
    recordSource(ctx, projectId, c.id, c.initialSource);
    setStage(ctx, projectId, 'confirmed', 'done', name);
    event(ctx, projectId, 'confirmed', 'success', `Started a preview for ${name} from your details.`);
  });
}

function activeFreeStatuses() {
  return `('queued','researching','building','needs_info','in_review','directions_ready','site_building','site_ready')`;
}

export function requestBuild(ctx: Ctx, projectId: string, sessionId: string): { started: boolean } {
  const p = getProject(ctx, projectId);
  if (!p.match_id) throw new UserError('Please confirm your business first.', 'invalid_state', 409);
  if (['queued', 'researching', 'building'].includes(p.status)) return { started: false }; // repeated tap
  if (p.status !== 'draft' && p.status !== 'needs_info') throw new UserError('This preview has already been built.', 'invalid_state', 409);
  const facts = effectiveFacts(ctx, projectId);
  const missing = missingEssentials(facts);
  if (missing.length) throw new UserError(`Please add: ${missing.join(', ')}.`, 'missing_info', 422);
  const limits = config.offer.limits;
  if (p.status === 'draft') {
    const sameBiz = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM projects WHERE business_key = ? AND id != ? AND status IN ${activeFreeStatuses()}`, p.business_key, projectId)!.n;
    if (sameBiz >= limits.activeFreePreviewsPerBusiness) {
      throw new UserError('A free preview for this business is already in progress. Sign in with the contact you used, or contact support and we’ll help.', 'limit_business', 429);
    }
    const sameSession = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM projects WHERE session_id = ? AND id != ? AND status IN ${activeFreeStatuses()}`, sessionId, projectId)!.n;
    const sameContact = p.contact_id ? ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM projects WHERE contact_id = ? AND id != ? AND status IN ${activeFreeStatuses()}`, p.contact_id, projectId)!.n : 0;
    if (Math.max(sameSession, sameContact) >= limits.activeFreePreviewsPerContact) {
      throw new UserError('You already have a free preview in progress. Open it from your dashboard, or contact support if you need another one.', 'limit_contact', 429);
    }
  }
  ctx.db.tx(() => {
    const buildNo = Number(p.build_no) + 1;
    ctx.db.run('UPDATE projects SET build_no = ?, facts_confirmed_at = COALESCE(facts_confirmed_at, ?), needs_info_json = ? WHERE id = ?', buildNo, now(), '[]', projectId);
    transition(ctx, projectId, 'queued');
    resetStages(ctx, projectId);
    setStage(ctx, projectId, 'gather', 'upcoming');
    event(ctx, projectId, 'gather', 'info', 'Your preview is in the queue.');
    enqueue(ctx, { projectId, type: 'research', key: `build:${projectId}:${buildNo}:research`, payload: { buildNo } });
  });
  track(ctx, 'preview_requested', projectId, { mode: ctx.mode });
  return { started: true };
}

export function regenerate(ctx: Ctx, projectId: string) {
  const p = getProject(ctx, projectId);
  if (p.status !== 'directions_ready') throw new UserError('You can rebuild the directions once they’re ready.', 'invalid_state', 409);
  if (Number(p.regenerations_used) >= config.offer.limits.freeRegenerations) {
    throw new UserError('You’ve used the free rebuilds for this preview. Send us a change request and we’ll help.', 'limit_regen', 429);
  }
  const buildNo = Number(p.build_no) + 1;
  ctx.db.tx(() => {
    ctx.db.run('UPDATE projects SET build_no = ?, regenerations_used = regenerations_used + 1 WHERE id = ?', buildNo, projectId);
    transition(ctx, projectId, 'queued');
    resetStages(ctx, projectId);
    event(ctx, projectId, 'organize', 'info', 'Rebuilding your directions with your latest details.');
    enqueue(ctx, { projectId, type: 'organize', key: `build:${projectId}:${buildNo}:organize`, payload: { buildNo } });
  });
}

export function chooseVariant(ctx: Ctx, projectId: string, variant: Variant) {
  const p = getProject(ctx, projectId);
  if (p.status === 'site_building' && p.chosen_variant === variant) return;
  if (p.status !== 'directions_ready' && p.status !== 'site_ready') throw new UserError('Designs aren’t ready to choose yet.', 'invalid_state', 409);
  if (p.status === 'site_ready' && p.chosen_variant === variant) return;
  const n = Number(p.build_no);
  ctx.db.tx(() => {
    ctx.db.run('UPDATE projects SET chosen_variant = ? WHERE id = ?', variant, projectId);
    transition(ctx, projectId, 'site_building');
    event(ctx, projectId, 'site', 'info', `You chose the ${VARIANTS[variant].name} design. Building the full site.`);
    enqueue(ctx, { projectId, type: 'build_site', key: `site:${projectId}:${n}:${variant}:${Date.now()}`, payload: { variant } });
  });
  track(ctx, 'design_chosen', projectId, { variant });
}

export function cancelProject(ctx: Ctx, projectId: string, actor: string) {
  const p = getProject(ctx, projectId);
  if (p.status === 'cancelled') return;
  ctx.db.tx(() => {
    ctx.db.run('UPDATE projects SET cancelled_at = ? WHERE id = ?', now(), projectId);
    transition(ctx, projectId, 'cancelled', actor);
    cancelProjectJobs(ctx, projectId);
  });
  track(ctx, 'cancelled', projectId);
}

// ---------- assets & versions ----------
export function assetsFor(ctx: Ctx, projectId: string): AssetView[] {
  return ctx.db.all('SELECT * FROM assets WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at', projectId).map((a) => ({
    id: a.id, url: `/files/${projectId}/${a.path.split('/').pop()}`, kind: a.kind, width: a.width ?? undefined, height: a.height ?? undefined, source: a.source, label: a.label ?? undefined,
  }));
}

export function currentVersion(ctx: Ctx, projectId: string): { id: string; number: number; content: SiteContent } | null {
  const r = ctx.db.get(`SELECT * FROM site_versions WHERE project_id = ? AND status = 'current' ORDER BY number DESC LIMIT 1`, projectId);
  return r ? { id: r.id, number: r.number, content: pj(r.content_json, null as any) } : null;
}

export function createVersion(ctx: Ctx, projectId: string, content: SiteContent, reason: string, author: 'system' | 'owner' | 'team', status: 'current' | 'proposed' = 'current', qa?: unknown): string {
  const id = newId('ver');
  ctx.db.tx(() => {
    const n = (ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(number), 0) n FROM site_versions WHERE project_id = ?', projectId)!.n) + 1;
    if (status === 'current') ctx.db.run(`UPDATE site_versions SET status = 'previous' WHERE project_id = ? AND status = 'current'`, projectId);
    ctx.db.run('INSERT INTO site_versions (id, project_id, number, content_json, reason, author, status, qa_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, projectId, n, j(content), reason, author, status, qa ? j(qa) : null, now());
  });
  return id;
}

export function contentFromFacts(ctx: Ctx, projectId: string, variant: Variant, prev?: SiteContent | null): SiteContent {
  const facts = effectiveFacts(ctx, projectId);
  const own = ownerFacts(ctx, projectId);
  return buildContent(facts, {
    variant,
    assets: assetsFor(ctx, projectId),
    sections: prev?.sections,
    overrides: prev?.overrides,
    ownerKeys: new Set(own.keys()),
  });
}

export function privateContacts(ctx: Ctx, projectId: string): string[] {
  const p = getProject(ctx, projectId);
  const facts = effectiveFacts(ctx, projectId);
  const out: string[] = [];
  const pref = ctx.db.get('SELECT c.destination FROM notification_prefs n JOIN contacts c ON c.id = n.contact_id WHERE n.project_id = ?', projectId);
  const owner = p.contact_id ? ctx.db.get('SELECT destination FROM contacts WHERE id = ?', p.contact_id) : null;
  for (const d of [pref?.destination, owner?.destination]) {
    if (d && d !== facts.publicPhone && d !== facts.publicEmail) out.push(d);
  }
  return out;
}

// ---------- view ----------
export function projectView(ctx: Ctx, projectId: string, opts: { sinceEvent?: number } = {}): ProjectView {
  const p = getProject(ctx, projectId);
  const candidate = p.candidate_json ? publicCandidate(pj<CandidateInternal>(p.candidate_json, null as any)) : null;
  const stageRows = new Map(ctx.db.all('SELECT * FROM stage_state WHERE project_id = ?', projectId).map((r) => [r.stage, r]));
  const stages: StageView[] = STAGES.map((s) => ({ key: s.key, label: s.label, state: (stageRows.get(s.key)?.state ?? 'upcoming') as any, detail: stageRows.get(s.key)?.detail ?? undefined }));
  const events: JobEventView[] = ctx.db.all('SELECT * FROM job_events WHERE project_id = ? AND id > ? ORDER BY id DESC LIMIT 40', projectId, opts.sinceEvent ?? 0)
    .reverse().map((e) => ({ id: e.id, at: e.at, stage: e.stage, level: e.level, message: e.message, simulated: !!e.simulated }));
  const pref = ctx.db.get('SELECT n.*, c.kind, c.destination, c.verified_at FROM notification_prefs n LEFT JOIN contacts c ON c.id = n.contact_id WHERE n.project_id = ?', projectId);
  const notifications: NotificationView[] = ctx.db.all('SELECT * FROM notifications WHERE project_id = ? ORDER BY created_at DESC LIMIT 10', projectId).map((n) => ({
    id: n.id, channel: n.channel, template: n.template, status: n.status, createdAt: n.created_at, error: n.error ?? undefined,
    destinationMasked: n.channel === 'email' ? maskEmail(n.destination) : maskPhone(n.destination),
  }));
  const cur = currentVersion(ctx, projectId);
  const versions: SiteVersionView[] = ctx.db.all('SELECT id, number, created_at, reason, author, status FROM site_versions WHERE project_id = ? ORDER BY number DESC LIMIT 20', projectId)
    .map((v) => ({ id: v.id, number: v.number, createdAt: v.created_at, reason: v.reason, author: v.author, status: v.status }));
  const crs: ChangeRequestView[] = ctx.db.all('SELECT * FROM change_requests WHERE project_id = ? ORDER BY created_at DESC LIMIT 20', projectId).map((c) => ({
    id: c.id, createdAt: c.created_at, message: c.message, status: c.status, kind: c.kind, response: c.response ?? undefined,
    proposedVersionId: c.proposed_version_id, attachmentUrl: c.attachment_asset_id ? assetsFor(ctx, projectId).find((a) => a.id === c.attachment_asset_id)?.url ?? null : null,
  }));
  const sub = ctx.db.get('SELECT * FROM subscriptions WHERE project_id = ?', projectId);
  const subscription: SubscriptionView = sub
    ? { status: sub.status, currentPeriodEnd: sub.current_period_end, provider: sub.provider, simulated: sub.provider === 'demo', lastError: sub.last_error }
    : { status: 'none', provider: null, simulated: ctx.demo };
  const d = ctx.db.get('SELECT * FROM domains WHERE project_id = ?', projectId);
  const domain: DomainView = d
    ? { domain: d.domain, mode: d.mode, status: d.status, sslStatus: d.ssl_status, records: pj(d.records_json, []), lastCheckedAt: d.last_checked_at, note: d.note ?? undefined, simulated: !!d.simulated }
    : { domain: null, mode: 'none', status: 'not_started', sslStatus: 'not_started', records: [], simulated: ctx.demo };
  const variant = (p.chosen_variant ?? null) as Variant | null;
  const hasDirections = !!cur && ['directions_ready', 'site_building', 'site_ready', 'paid', 'launching', 'live', 'in_review'].includes(p.status);
  const facts = factViews(ctx, projectId);
  const name = String(facts.find((f) => f.key === 'displayName')?.value ?? candidate?.name ?? '');
  return {
    id: p.id,
    status: p.status,
    mode: p.mode,
    businessName: name,
    city: candidate?.city ?? null,
    candidate,
    candidates: p.match_id ? [] : pj<CandidateInternal[]>(p.candidates_json, []).map(publicCandidate),
    intakeQuery: p.intake_query,
    facts,
    stages,
    events,
    assets: assetsFor(ctx, projectId).filter((a) => a.kind !== 'attachment'),
    notification: {
      channel: pref?.channel ?? 'none',
      destinationMasked: pref?.destination ? (pref.kind === 'email' ? maskEmail(pref.destination) : maskPhone(pref.destination)) : null,
      verified: !!pref?.verified_at,
      marketingOptIn: !!pref?.marketing_opt_in,
    },
    notifications,
    variants: hasDirections ? (['a', 'b'] as Variant[]).map((k) => ({ key: k, name: VARIANTS[k].name, summary: VARIANTS[k].summary, previewUrl: `/preview/${p.id}/${k}/` })) : [],
    chosenVariant: variant,
    sitePages: cur && variant && ['site_ready', 'paid', 'launching', 'live'].includes(p.status) ? sitePages({ ...cur.content, variant }) : [],
    siteVersions: versions,
    changeRequests: crs,
    subscription,
    domain,
    liveUrl: p.status === 'live' ? p.live_url : null,
    liveIsSimulated: p.status === 'live' && ctx.adapters.publish.simulated,
    regenerationsLeft: Math.max(0, config.offer.limits.freeRegenerations - Number(p.regenerations_used)),
    needsInfo: pj<string[]>(p.needs_info_json, []),
    hasSavedAccess: !!p.contact_id,
    launchApproved: !!p.launch_approved_at,
    updatedAt: p.updated_at,
  };
}

export function requirePreviewReview(ctx: Ctx): boolean {
  return getSettings(ctx).requirePreviewReview;
}
