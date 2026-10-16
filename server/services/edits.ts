// Self-service edits, version history/restore, and team change requests with
// preview-before-approval. Patches touch only the fields they name, so a team
// proposal approved later never overwrites unrelated owner edits made meanwhile.
import type { Ctx } from '../ctx.ts';
import { now, newId, j, pj } from '../db.ts';
import type { FactKey } from '../../shared/types.ts';
import { normalizePhone, isEmail, isHexColor, clampText } from '../../shared/validate.ts';
import { config } from '../config.ts';
import { UserError, getProject, currentVersion, createVersion, contentFromFacts } from './projects.ts';
import { setOwnerFacts } from './facts.ts';
import { enqueue } from './jobs.ts';
import { event, track, audit } from './events.ts';
import { queueNotification } from './notify.ts';
import { safeHttpUrl } from './validation.ts';
import type { SiteContent } from './sitegen.ts';

export interface EditPatch {
  facts?: Partial<Record<FactKey, unknown>>;
  sections?: Partial<SiteContent['sections']>;
  overrides?: SiteContent['overrides'];
}

const EDITABLE_STATUSES = ['directions_ready', 'site_ready', 'paid', 'launching', 'live'];

/** Validates and normalizes owner-supplied fact values. Throws UserError with the field name. */
export function cleanFacts(input: Record<string, unknown>): Partial<Record<FactKey, unknown>> {
  const out: Partial<Record<FactKey, unknown>> = {};
  const str = (k: string, max: number) => clampText(input[k], max);
  const list = (k: string, maxItems: number, maxLen: number) => {
    const v = input[k];
    if (!Array.isArray(v)) throw new UserError('Invalid list.', 'invalid', 422, k);
    return [...new Set(v.map((x) => clampText(x, maxLen)).filter(Boolean))].slice(0, maxItems);
  };
  for (const k of Object.keys(input)) {
    switch (k) {
      case 'displayName': {
        const v = str(k, 120);
        if (v.length < 2) throw new UserError('Please enter your business name.', 'invalid', 422, k);
        out.displayName = v;
        break;
      }
      case 'services': {
        const v = list(k, 12, 60);
        if (!v.length) throw new UserError('Choose at least one service.', 'invalid', 422, k);
        out.services = v;
        break;
      }
      case 'areas': {
        const v = list(k, 20, 60);
        if (!v.length) throw new UserError('Add at least one area you serve.', 'invalid', 422, k);
        out.areas = v;
        break;
      }
      case 'publicPhone': {
        const raw = str(k, 40);
        if (!raw) { out.publicPhone = null; break; }
        const p = normalizePhone(raw);
        if (!p) throw new UserError('That phone number doesn’t look complete.', 'invalid', 422, k);
        out.publicPhone = p;
        break;
      }
      case 'publicEmail': {
        const raw = str(k, 254).toLowerCase();
        if (raw && !isEmail(raw)) throw new UserError('That email address doesn’t look right.', 'invalid', 422, k);
        out.publicEmail = raw || null;
        break;
      }
      case 'preferredContact':
        out.preferredContact = ['phone', 'email', 'form'].includes(String(input[k])) ? input[k] : 'phone';
        break;
      case 'mainAction':
        out.mainAction = input[k] === 'contact' ? 'contact' : 'quote';
        break;
      case 'description': out.description = str(k, 600) || null; break;
      case 'differentiator': out.differentiator = str(k, 280) || null; break;
      case 'hours': out.hours = str(k, 200) || null; break;
      case 'pricing': out.pricing = str(k, 300) || null; break;
      case 'showHours': out.showHours = input[k] === true; break;
      case 'showPricing': out.showPricing = input[k] === true; break;
      case 'stylePreference': out.stylePreference = ['bright', 'calm', 'none'].includes(String(input[k])) ? input[k] : 'none'; break;
      case 'accentColor': {
        const v = str(k, 7);
        if (v && !isHexColor(v)) throw new UserError('Pick a colour from the list.', 'invalid', 422, k);
        out.accentColor = v || null;
        break;
      }
      case 'bookingUrl': {
        const v = str(k, 500);
        out.bookingUrl = v ? safeHttpUrl(v, k) : null;
        break;
      }
      case 'otherLinks': out.otherLinks = list(k, 5, 500).map((u) => safeHttpUrl(u, k)); break;
      case 'logoAssetId': out.logoAssetId = input[k] ? str(k, 40) : null; break;
      case 'photoAssetIds': out.photoAssetIds = list(k, 8, 40); break;
      default:
        break; // ignore unknown keys
    }
  }
  return out;
}

function changedLabel(patch: EditPatch): string {
  const names: Record<string, string> = {
    displayName: 'name', publicPhone: 'phone', publicEmail: 'email', services: 'services', areas: 'areas', description: 'description',
    differentiator: 'what makes you different', accentColor: 'colour', hours: 'hours', pricing: 'pricing', showHours: 'hours display',
    showPricing: 'pricing display', bookingUrl: 'booking link', mainAction: 'main button', photoAssetIds: 'photos', logoAssetId: 'logo',
    heroTitle: 'headline', heroSub: 'intro text', aboutText: 'about text',
  };
  const keys = [...Object.keys(patch.facts ?? {}), ...Object.keys(patch.overrides ?? {}), ...Object.keys(patch.sections ?? {}).map((s) => `${s} section`)];
  return keys.map((k) => names[k] ?? k).join(', ');
}

function cleanPatch(raw: any): EditPatch {
  const patch: EditPatch = {};
  if (raw?.facts && typeof raw.facts === 'object') patch.facts = cleanFacts(raw.facts);
  if (raw?.sections && typeof raw.sections === 'object') {
    patch.sections = {};
    for (const k of ['photos', 'areas', 'hours', 'pricing', 'about'] as const) if (typeof raw.sections[k] === 'boolean') patch.sections[k] = raw.sections[k];
  }
  if (raw?.overrides && typeof raw.overrides === 'object') {
    patch.overrides = {};
    for (const k of ['heroTitle', 'heroSub', 'aboutText'] as const) if (typeof raw.overrides[k] === 'string') patch.overrides[k] = clampText(raw.overrides[k], k === 'aboutText' ? 800 : 200);
  }
  return patch;
}

/** Applies a patch onto the CURRENT content and makes it the new current version. */
function applyPatch(ctx: Ctx, projectId: string, patch: EditPatch, reason: string, author: 'owner' | 'team'): string {
  const cur = currentVersion(ctx, projectId);
  if (!cur) throw new UserError('There’s no site to edit yet.', 'invalid_state', 409);
  if (patch.facts && Object.keys(patch.facts).length) setOwnerFacts(ctx, projectId, patch.facts);
  const prev: SiteContent = {
    ...cur.content,
    sections: { ...cur.content.sections, ...(patch.sections ?? {}) },
    overrides: { ...cur.content.overrides, ...(patch.overrides ?? {}) },
  };
  for (const [k, v] of Object.entries(prev.overrides)) if (!v) delete (prev.overrides as any)[k];
  const next = contentFromFacts(ctx, projectId, cur.content.variant, prev);
  const id = createVersion(ctx, projectId, next, reason, author);
  republishIfLive(ctx, projectId, id);
  return id;
}

function republishIfLive(ctx: Ctx, projectId: string, versionId: string) {
  const p = getProject(ctx, projectId);
  if (p.status === 'live') enqueue(ctx, { projectId, type: 'launch', key: `republish:${projectId}:${versionId}`, payload: { republish: true } });
}

export function selfServiceEdit(ctx: Ctx, projectId: string, raw: unknown) {
  const p = getProject(ctx, projectId);
  if (!EDITABLE_STATUSES.includes(p.status)) throw new UserError('Edits open once your preview is ready.', 'invalid_state', 409);
  const patch = cleanPatch(raw);
  const label = changedLabel(patch);
  if (!label) throw new UserError('Nothing to change.', 'no_change', 422);
  const id = applyPatch(ctx, projectId, patch, `You changed: ${label}`, 'owner');
  event(ctx, projectId, 'edit', 'success', `Saved your change (${label}).`);
  track(ctx, 'edit_applied', projectId);
  return id;
}

const RESTORE_FACT_MAP: [FactKey, (c: SiteContent) => unknown][] = [
  ['displayName', (c) => c.business.name], ['publicPhone', (c) => c.business.phone], ['publicEmail', (c) => c.business.email],
  ['services', (c) => c.business.services], ['areas', (c) => c.business.areas], ['description', (c) => c.business.description],
  ['differentiator', (c) => c.business.differentiator], ['accentColor', (c) => c.design.accent], ['bookingUrl', (c) => c.business.bookingUrl],
  ['mainAction', (c) => c.business.mainAction],
];

export function restoreVersion(ctx: Ctx, projectId: string, versionId: string, actor: 'owner' | 'team' = 'owner') {
  const v = ctx.db.get(`SELECT * FROM site_versions WHERE id = ? AND project_id = ? AND status IN ('previous', 'current')`, versionId, projectId);
  if (!v) throw new UserError('That version can’t be restored.', 'not_found', 404);
  if (v.status === 'current') return v.id;
  const content = pj<SiteContent>(v.content_json, null as any);
  // Keep owner facts consistent with the restored content so later edits build on it.
  const facts: Partial<Record<FactKey, unknown>> = {};
  for (const [k, get] of RESTORE_FACT_MAP) facts[k] = get(content);
  setOwnerFacts(ctx, projectId, facts);
  const cur = currentVersion(ctx, projectId);
  const id = createVersion(ctx, projectId, { ...content, variant: cur?.content.variant ?? content.variant }, `Restored version ${v.number}`, actor);
  event(ctx, projectId, 'edit', 'info', `Restored version ${v.number}.`);
  republishIfLive(ctx, projectId, id);
  return id;
}

export function createChangeRequest(ctx: Ctx, projectId: string, message: string, attachmentAssetId: string | null, idempotencyKey: string) {
  const p = getProject(ctx, projectId);
  if (!EDITABLE_STATUSES.includes(p.status)) throw new UserError('You can request changes once your preview is ready.', 'invalid_state', 409);
  const key = `cr:${projectId}:${clampText(idempotencyKey, 80)}`;
  const existing = ctx.db.get('SELECT id FROM change_requests WHERE idempotency_key = ?', key);
  if (existing) return { id: existing.id, duplicate: true };
  const open = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM change_requests WHERE project_id = ? AND status IN ('received', 'in_progress', 'proposed')`, projectId)!.n;
  if (open >= config.offer.limits.openChangeRequestsPerProject) throw new UserError('You have several requests open already. We’ll work through those first.', 'limit_requests', 429);
  const text = clampText(message, 2000);
  if (text.length < 5) throw new UserError('Tell us a little more about the change.', 'invalid', 422, 'message');
  if (attachmentAssetId && !ctx.db.get('SELECT 1 FROM assets WHERE id = ? AND project_id = ?', attachmentAssetId, projectId)) attachmentAssetId = null;
  const id = newId('cr');
  ctx.db.run('INSERT INTO change_requests (id, project_id, message, kind, status, attachment_asset_id, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, projectId, text, 'team', 'received', attachmentAssetId, key, now(), now());
  event(ctx, projectId, 'edit', 'info', 'We received your change request.');
  track(ctx, 'edit_requested', projectId);
  return { id, duplicate: false };
}

/** Team prepares a proposal; owner previews it before it goes anywhere. */
export function proposeChange(ctx: Ctx, projectId: string, crId: string, rawPatch: unknown, response: string) {
  const cr = ctx.db.get('SELECT * FROM change_requests WHERE id = ? AND project_id = ?', crId, projectId);
  if (!cr) throw new UserError('Request not found.', 'not_found', 404);
  const patch = cleanPatch(rawPatch);
  const cur = currentVersion(ctx, projectId);
  if (!cur) throw new UserError('No site yet.', 'invalid_state', 409);
  const preview: SiteContent = {
    ...cur.content,
    sections: { ...cur.content.sections, ...(patch.sections ?? {}) },
    overrides: { ...cur.content.overrides, ...(patch.overrides ?? {}) },
  };
  if (patch.facts) {
    // Preview-only fact application (not persisted until approved).
    const b = { ...preview.business };
    if (patch.facts.displayName) b.name = String(patch.facts.displayName);
    if (patch.facts.publicPhone !== undefined) b.phone = patch.facts.publicPhone as string | null;
    if (patch.facts.publicEmail !== undefined) b.email = patch.facts.publicEmail as string | null;
    if (patch.facts.services) b.services = patch.facts.services as string[];
    if (patch.facts.areas) b.areas = patch.facts.areas as string[];
    if (patch.facts.description !== undefined) b.description = patch.facts.description as string | null;
    preview.business = b;
  }
  const vid = createVersion(ctx, projectId, preview, `Proposed: ${changedLabel(patch) || 'change'}`, 'team', 'proposed');
  ctx.db.run(`UPDATE change_requests SET status = 'proposed', response = ?, proposed_version_id = ?, patch_json = ?, updated_at = ? WHERE id = ?`,
    clampText(response, 1000), vid, j(patch), now(), crId);
  event(ctx, projectId, 'edit', 'info', 'A proposed change is ready for you to preview and approve.');
  queueNotification(ctx, projectId, 'change_ready', `change_ready:${crId}:${vid}`);
  audit(ctx, projectId, 'team', 'change_proposed', { crId });
}

export function decideProposal(ctx: Ctx, projectId: string, crId: string, approve: boolean) {
  const cr = ctx.db.get('SELECT * FROM change_requests WHERE id = ? AND project_id = ?', crId, projectId);
  if (!cr) throw new UserError('Request not found.', 'not_found', 404);
  if (cr.status !== 'proposed') return; // idempotent
  ctx.db.tx(() => {
    if (approve) {
      const patch = pj<EditPatch>(cr.patch_json, {});
      applyPatch(ctx, projectId, patch, `Approved change: ${changedLabel(patch) || 'update'}`, 'team');
      ctx.db.run(`UPDATE site_versions SET status = 'previous' WHERE id = ?`, cr.proposed_version_id);
      ctx.db.run(`UPDATE change_requests SET status = 'done', updated_at = ? WHERE id = ?`, now(), crId);
      event(ctx, projectId, 'edit', 'success', 'You approved the proposed change.');
    } else {
      ctx.db.run(`UPDATE site_versions SET status = 'rejected' WHERE id = ?`, cr.proposed_version_id);
      ctx.db.run(`UPDATE change_requests SET status = 'in_progress', updated_at = ? WHERE id = ?`, now(), crId);
      event(ctx, projectId, 'edit', 'info', 'You sent the proposal back. We’ll take another look.');
    }
  });
}

export function teamUpdateRequest(ctx: Ctx, projectId: string, crId: string, status: 'in_progress' | 'done' | 'declined', response: string) {
  const r = ctx.db.run('UPDATE change_requests SET status = ?, response = ?, updated_at = ? WHERE id = ? AND project_id = ?', status, clampText(response, 1000) || null, now(), crId, projectId);
  if (!r.changes) throw new UserError('Request not found.', 'not_found', 404);
}
