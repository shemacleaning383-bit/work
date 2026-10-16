import type { Ctx } from '../ctx.ts';
import { now, j } from '../db.ts';
import type { StageKey, StageState } from '../../shared/types.ts';

export const STAGES: { key: StageKey; label: string }[] = [
  { key: 'confirmed', label: 'Business confirmed' },
  { key: 'gather', label: 'Gathering public business information' },
  { key: 'organize', label: 'Organizing services and approved assets' },
  { key: 'design', label: 'Preparing two homepage directions' },
  { key: 'qa', label: 'Checking mobile layout and content' },
  { key: 'ready', label: 'Preview ready' },
];

export function event(ctx: Ctx, projectId: string, stage: string, level: 'info' | 'warn' | 'error' | 'success', message: string, extra: { jobId?: string; internal?: string } = {}) {
  ctx.db.run(
    'INSERT INTO job_events (project_id, job_id, stage, level, message, internal, simulated, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    projectId, extra.jobId ?? null, stage, level, message, extra.internal ?? null, ctx.demo ? 1 : 0, now(),
  );
  touch(ctx, projectId);
}

export function setStage(ctx: Ctx, projectId: string, stage: StageKey, state: StageState, detail?: string) {
  ctx.db.run(
    `INSERT INTO stage_state (project_id, stage, state, detail, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, stage) DO UPDATE SET state = excluded.state, detail = excluded.detail, updated_at = excluded.updated_at`,
    projectId, stage, state, detail ?? null, now(),
  );
  touch(ctx, projectId);
}

export function resetStages(ctx: Ctx, projectId: string) {
  ctx.db.run(`DELETE FROM stage_state WHERE project_id = ? AND stage != 'confirmed'`, projectId);
}

export function touch(ctx: Ctx, projectId: string) {
  ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', now(), projectId);
}

export function audit(ctx: Ctx, projectId: string | null, actor: string, action: string, detail: unknown = {}) {
  ctx.db.run('INSERT INTO audit_events (project_id, actor, action, detail_json, at) VALUES (?, ?, ?, ?, ?)', projectId, actor, action, j(detail), now());
}

// Conversion analytics: event names and coarse, non-personal properties only.
const ALLOWED_EVENTS = new Set([
  'intake_started', 'lookup_result', 'business_confirmed', 'business_rejected', 'preview_requested', 'preview_ready',
  'preview_viewed', 'design_chosen', 'site_ready', 'edit_requested', 'edit_applied', 'checkout_started',
  'subscribed', 'payment_failed', 'launched', 'cancelled', 'notification_failed',
]);
export function track(ctx: Ctx, name: string, projectId: string | null, props: Record<string, string | number | boolean> = {}) {
  if (!ALLOWED_EVENTS.has(name)) return;
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) if (/^(kind|status|variant|mode|count|ms|source|result|stage)$/.test(k)) safe[k] = v;
  ctx.db.run('INSERT INTO analytics_events (name, project_id, props_json, at) VALUES (?, ?, ?, ?)', name, projectId, j(safe), now());
}
